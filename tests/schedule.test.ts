// Run with: npm test. Times are Kyiv wall-clock (TZ is set in package.json).
import { computeSchedule } from '../src/schedule.ts';
import { formatMinutes, formatClock, isoLocal } from '../src/time.ts';
import { resolveCurfew } from '../src/curfew.ts';
import type { Trip, Stop, Leg } from '../src/types.ts';

declare const process: { exit(code: number): never };

let pass = 0;
const failures: string[] = [];

function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ok   ' + what); }
  else { failures.push(what); console.log('  FAIL ' + what + '\n        got ' + a + '\n        want ' + b); }
}

const settings = {
  dayStart: '09:00', dayEnd: '20:00',
  avgSpeedKmh: 70, roadFactor: 1.25, stopBufferMinutes: 0,
};

let n = 0;
/** Lviv oblast by default: curfew 00:00–05:00. */
const stop = (name: string, opts: Partial<Stop> = {}): Stop => ({
  id: 's' + (++n), name, lat: 50, lon: 30, label: name, region: 'UA-46',
  overnight: false, activities: [], leg: null, ...opts,
});
const car = (km: number, minutes: number): Leg => ({ mode: 'car', source: 'manual', km, minutes });
const train = (departAt: string, arriveAt: string): Leg => ({ mode: 'transit', kind: 'train', departAt, arriveAt });
const act = (title: string, minutes: number) => ({ id: 'a' + (++n), title, minutes });
const at = (d: Date) => isoLocal(d);

const trip = (stops: Stop[], over: Partial<Trip> = {}): Trip => ({
  version: 2, title: 't', mode: 'car', start: '2026-09-16T09:00',
  settings, stops, parked: [], ...over,
});

console.log('\n1. Car: drive time lands where plain arithmetic says');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(140, 120) })]));
  eq(formatClock(s.stops[0].arrive), '09:00', 'start at 09:00');
  eq(formatClock(s.stops[1].arrive), '11:00', 'after 2h drive -> 11:00');
  eq(s.totals.travelMinutes, 120, 'travel total is 120 minutes');
  eq(Math.round(s.totals.km), 140, 'km total');
}

console.log('\n2. Activities push the departure, minute-exact');
{
  const s = computeSchedule(trip([
    stop('A', { activities: [act('breakfast', 45), act('museum', 90)] }),
    stop('B', { leg: car(70, 60) }),
  ]));
  eq(formatClock(s.stops[0].activitiesEnd), '11:15', '45m + 90m from 09:00 -> 11:15');
  eq(s.stops[0].activities.map(a => formatClock(a.start)), ['09:00', '09:45'], 'each activity gets its own start');
  eq(formatClock(s.stops[1].arrive), '12:15', 'then 1h drive -> 12:15');
}

console.log('\n3. Durations read as hours and minutes, in Ukrainian');
{
  eq(formatMinutes(135), '2 год 15 хв', '135 -> 2 год 15 хв');
  eq(formatMinutes(45), '45 хв', '45 -> 45 хв');
  eq(formatMinutes(120), '2 год', '120 -> 2 год');
}

console.log('\n4. A drive longer than a day pauses overnight and is flagged');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(1400, 20 * 60) })]));
  eq(s.stops[1].warnings.includes('overnight-en-route'), true, 'flagged as overnight en route');
  eq(at(s.stops[1].arrive), '2026-09-17T18:00', '11h on day one, 9h on day two');
  eq(s.totals.travelMinutes, 20 * 60, 'total driving still exactly 20h');
}

console.log('\n5. Transit: times come from the timetable, and there is no km');
{
  const leg = train('2026-09-16T14:30', '2026-09-16T19:05');
  const s = computeSchedule(trip([stop('A', { activities: [act('lunch', 60)] }), stop('B', { leg })], { mode: 'transit' }));
  eq(formatClock(s.stops[1].arrive), '19:05', 'arrival is the timetable arrival');
  eq(s.totals.km, 0, 'no kilometres anywhere');
  eq('km' in leg, false, 'a transit leg has no km field at all');
  eq(s.totals.travelMinutes, 275, 'travel = 4h35 from the timetable');
}

console.log('\n6. Free time before a departure, and the warning when it is negative');
{
  const mk = (lunch: number) => computeSchedule(trip([
    stop('A', { activities: [act('lunch', lunch)] }),
    stop('B', { leg: train('2026-09-16T14:00', '2026-09-16T17:00') }),
  ], { mode: 'transit' }));

  const roomy = mk(60);
  eq(roomy.stops[0].freeMinutes, 240, 'finish 10:00, train 14:00 -> 4h free');
  eq(roomy.stops[0].warnings, [], 'no warning when there is room');

  const tight = mk(8 * 60);
  eq(tight.stops[0].warnings.includes('will-miss-departure'), true, 'finishing after the train leaves is flagged');
}

console.log('\n7. Overnight stay moves departure to the next morning');
{
  const s = computeSchedule(trip([
    stop('A', { overnight: true, activities: [act('walk', 60)] }),
    stop('B', { leg: car(70, 60) }),
  ]));
  eq(at(s.stops[0].depart), '2026-09-17T09:00', 'leaves next day at dayStart');
  eq(formatClock(s.stops[1].arrive), '10:00', 'and arrives an hour later');
  eq(s.stops[0].nightHere, true, 'the card knows a night is spent here');
}

console.log('\n8. Day totals add up to the trip totals');
{
  const s = computeSchedule(trip([
    stop('A', { activities: [act('x', 90)] }),
    stop('B', { leg: car(300, 260), activities: [act('y', 120)] }),
    stop('C', { leg: car(150, 130) }),
  ]));
  const sumTravel = s.days.reduce((t, d) => t + d.travelMinutes, 0);
  const sumAct = s.days.reduce((t, d) => t + d.activityMinutes, 0);
  eq(sumTravel, s.totals.travelMinutes, 'per-day travel sums to the total');
  eq(sumAct, s.totals.activityMinutes, 'per-day activities sum to the total');
  eq(s.totals.travelMinutes, 390, 'travel = 260 + 130');
  eq(s.totals.activityMinutes, 210, 'activities = 90 + 120');
}

// ---------------------------------------------------------------------------
// The bugs testers ran into. Each one failed before this change.
// ---------------------------------------------------------------------------

console.log('\nA. The start time the traveller set is kept, even before their usual day');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(140, 120) })], { start: '2026-09-16T06:00' }));
  eq(at(s.stops[0].depart), '2026-09-16T06:00', 'set off at 06:00, as asked');
  eq(s.stops[0].notes, [], 'nothing to explain');
  eq(formatClock(s.stops[1].arrive), '08:00', 'arrive 08:00');
}

console.log('\nA2. A start inside the curfew waits for it to end, and says so');
{
  // Lviv oblast: 00:00–05:00. Long drives start right after it.
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(540, 7 * 60) })], { start: '2026-09-16T04:00' }));
  eq(at(s.stops[0].depart), '2026-09-16T05:00', 'set off at 05:00, when the curfew ends');
  eq(s.stops[0].notes, ['wait-curfew'], 'the card says it is the curfew');
  eq(formatClock(s.stops[1].arrive), '12:00', 'arrive 12:00');
}

console.log('\nA3. On the first day, plans after an early start do not wait for 09:00 either');
{
  const s = computeSchedule(trip([
    stop('A', { activities: [act('pack the car', 30)] }),
    stop('B', { leg: car(70, 60), activities: [act('breakfast', 45)] }),
  ], { start: '2026-09-16T05:00' }));
  eq(formatClock(s.stops[0].activities[0].start), '05:00', 'packing at 05:00');
  eq(formatClock(s.stops[1].activities[0].start), '06:30', 'breakfast on arrival at 06:30');
}

console.log('\nA4. Later mornings still follow "my day"');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(70, 60), overnight: true }),
    stop('C', { leg: car(70, 60) }),
  ], { start: '2026-09-16T05:00' }));
  eq(at(s.stops[1].depart), '2026-09-17T09:00', 'after the night, leave at dayStart');
}

console.log('\nB. A three-day drive: every calendar day is counted');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(2100, 30 * 60) })]));
  eq(s.days.map(d => d.key), ['2026-09-16', '2026-09-17', '2026-09-18'], 'three days, in order');
  eq(s.totals.days, 3, 'days = 3');
  eq(s.days.map(d => d.travelMinutes), [660, 660, 480], '11h + 11h + 8h of driving');
}

console.log('\nC. A night at the start with nothing planned still counts as a day');
{
  const s = computeSchedule(trip([stop('A', { overnight: true }), stop('B', { leg: car(70, 60) })]));
  eq(s.days.map(d => d.key), ['2026-09-16', '2026-09-17'], 'both days present');
  eq(s.totals.days, 2, 'days = 2');
}

console.log('\nD. An activity is never cut in two by the night');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 14 * 60 + 30), activities: [act('museum', 120)] }),
  ], { start: '2026-09-16T09:00', settings: { ...settings, dayEnd: '23:30' } }));
  eq(at(s.stops[1].arrive), '2026-09-16T23:30', 'arrive 23:30, half an hour before curfew');
  eq(at(s.stops[1].activities[0].start), '2026-09-17T09:00', 'the museum moves whole to the morning');
  eq(at(s.stops[1].activities[0].end), '2026-09-17T11:00', 'and keeps its two hours');
  eq(s.stops[1].warnings.includes('activity-moved'), true, 'flagged as moved');
}

console.log('\nD2. An evening activity is fine: only the curfew ends the day for activities');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 630), activities: [act('dinner', 120)] }),
  ]));
  eq(at(s.stops[1].arrive), '2026-09-16T19:30', 'arrive 19:30');
  eq(at(s.stops[1].activitiesEnd), '2026-09-16T21:30', 'dinner until 21:30, same evening');
  eq(s.stops[1].warnings, [], 'nothing to warn about');
}

console.log('\nE. "Overnight" means one night, even when plans moved to the morning');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 14 * 60 + 30), activities: [act('museum', 120)], overnight: true }),
    stop('C', { leg: car(70, 60) }),
  ], { settings: { ...settings, dayEnd: '23:30' } }));
  eq(at(s.stops[1].depart), '2026-09-17T11:00', 'leave after the museum, the next day');
  eq(at(s.stops[2].arrive), '2026-09-17T12:00', 'not two days later');
}

console.log('\nF. Arriving too late to go on: the night is spent here, and said so');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 630), activities: [act('dinner', 60)] }),
    stop('C', { leg: car(70, 60) }),
  ]));
  eq(at(s.stops[1].depart), '2026-09-17T09:00', 'next leg starts in the morning');
  eq(s.stops[1].notes, ['night-auto'], 'the card says it is a night here');
  eq(s.stops[1].nightHere, true, 'nightHere');
}

console.log('\nF2. A drive that does not fit in what is left of today starts tomorrow morning');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(420, 7 * 60), activities: [act('market', 120), act('dinner', 90)] }),
    stop('C', { leg: car(260, 5 * 60) }),
  ]));
  eq(at(s.stops[1].activitiesEnd), '2026-09-16T19:30', 'done at 19:30');
  eq(at(s.stops[1].depart), '2026-09-17T09:00', 'leave at 09:00 tomorrow, not drive 30 min tonight');
  eq(s.stops[1].notes, ['night-auto'], 'a night here, explained');
  eq(s.stops[2].warnings.includes('overnight-en-route'), false, 'no night on the road');
  eq(at(s.stops[2].arrive), '2026-09-17T14:00', 'arrive 14:00');
}

console.log('\nG. A stop without distance is flagged, not driven in zero minutes');
{
  const s = computeSchedule(trip([stop('Kyiv'), stop('Lviv', { leg: car(0, 0) })]));
  eq(s.stops[1].warnings.includes('leg-unknown'), true, 'flagged: distance unknown');
}

console.log('\nH. The clock change (25 Oct 2026) does not shift the day by an hour');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(1000, 14 * 60) })], { start: '2026-10-25T09:00' }));
  eq(at(s.stops[1].arrive), '2026-10-26T12:00', '11h on the 25th (09–20), 3h on the 26th');
}

// ---------------------------------------------------------------------------
// Curfew
// ---------------------------------------------------------------------------

console.log('\nK1. Driving does not run into the curfew');
{
  // Kherson oblast: 21:00–05:00. With a late personal day, the curfew is what stops the car.
  const s = computeSchedule(trip([
    stop('A', { region: 'UA-65' }),
    stop('B', { region: 'UA-65', leg: car(900, 13 * 60) }),
  ], { settings: { ...settings, dayEnd: '23:00' } }));
  eq(at(s.stops[1].arrive), '2026-09-17T10:00', '12h until 21:00, then 1h from 09:00');
  eq(s.stops[1].warnings.includes('overnight-en-route'), true, 'flagged');
}

console.log('\nK2. The stricter curfew of the two ends of a leg applies');
{
  // From Kyiv (01:00–05:00) to Kherson oblast (21:00–05:00).
  const s = computeSchedule(trip([
    stop('Kyiv', { region: 'UA-30' }),
    stop('Kherson', { region: 'UA-65', leg: car(550, 7 * 60) }),
  ], { start: '2026-09-16T15:00', settings: { ...settings, dayEnd: '23:59' } }));
  // Only 6h before Kherson's 21:00 today, a whole 12h tomorrow: go in the morning.
  eq(at(s.stops[0].depart), '2026-09-17T09:00', 'cannot arrive before 21:00 today, so leave tomorrow');
  eq(at(s.stops[1].arrive), '2026-09-17T16:00', 'arrive 16:00, in one go');
}

console.log('\nK3. No curfew in Zakarpattia: only the personal day limits the drive');
{
  const s = computeSchedule(trip([
    stop('A', { region: 'UA-21' }),
    stop('B', { region: 'UA-21', leg: car(100, 120) }),
  ], { start: '2026-09-16T22:30', settings: { ...settings, dayEnd: '23:59' } }));
  eq(at(s.stops[1].arrive), '2026-09-17T11:00', '2h do not fit before 23:59, so 09:00–11:00 next day');
  eq(s.stops[0].warnings.length + s.stops[1].warnings.length, 0, 'and no curfew warning anywhere');
}

console.log('\nK4. A train arriving during curfew is allowed, with a warning; plans wait for morning');
{
  const s = computeSchedule(trip([
    stop('Kyiv', { region: 'UA-30' }),
    stop('Lviv', { region: 'UA-46', leg: train('2026-09-16T22:00', '2026-09-17T03:10'), activities: [act('coffee', 30)] }),
  ], { mode: 'transit' }));
  eq(s.stops[1].warnings.includes('arrives-during-curfew'), true, 'flagged');
  eq(at(s.stops[1].activities[0].start), '2026-09-17T09:00', 'coffee waits until the day starts');
  eq(s.stops[1].warnings.includes('activity-moved'), false, 'that is waiting, not moving to another day');
}

console.log('\nK5. A train leaving during curfew is flagged on the stop you leave from');
{
  const s = computeSchedule(trip([
    stop('Lviv', { region: 'UA-46' }),
    stop('Kyiv', { region: 'UA-30', leg: train('2026-09-17T00:40', '2026-09-17T07:30') }),
  ], { mode: 'transit' }));
  eq(s.stops[0].warnings.includes('departs-during-curfew'), true, 'flagged');
}

console.log('\nK6. A hand-corrected curfew wins over the table; unknown regions use the default');
{
  eq(resolveCurfew({ region: 'UA-46', curfewOverride: { kind: 'none' } }).curfew, null, 'override: none');
  eq(resolveCurfew({ region: 'UA-46', curfewOverride: { kind: 'hours', start: '23:00', end: '05:00' } }).curfew,
    { start: '23:00', end: '05:00' }, 'override: hours');
  eq(resolveCurfew({}).source, 'default', 'no region -> default');
  eq(resolveCurfew({}).curfew, { start: '00:00', end: '05:00' }, 'default is 00:00–05:00');
  eq(resolveCurfew({ region: 'PL-MA' }).curfew, null, 'abroad -> none');
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
