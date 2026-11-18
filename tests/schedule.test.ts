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

import type { Settings } from '../src/types.ts';

/** The defaults: only the curfew limits anything. */
const settings: Settings = {
  morning: '05:00', driveUntil: null, drivers: 1,
  avgSpeedKmh: 70, roadFactor: 1.25, stopBufferMinutes: 0,
};
/** A traveller who chose their own hours: from 09:00, not after 20:00. */
const own: Settings = { ...settings, morning: '09:00', driveUntil: '20:00' };

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
    stop('A', { activities: [act('x', 45), act('y', 90)] }),
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

console.log('\n4. Transit: times come from the timetable, and there is no km');
{
  const leg = train('2026-09-16T14:30', '2026-09-16T19:05');
  const s = computeSchedule(trip([stop('A', { activities: [act('x', 60)] }), stop('B', { leg })], { mode: 'transit' }));
  eq(formatClock(s.stops[1].arrive), '19:05', 'arrival is the timetable arrival');
  eq(s.totals.km, 0, 'no kilometres anywhere');
  eq('km' in leg, false, 'a transit leg has no km field at all');
  eq(s.totals.travelMinutes, 275, 'travel = 4h35 from the timetable');
}

console.log('\n5. Free time before a departure, and the warning when it is negative');
{
  const mk = (minutes: number) => computeSchedule(trip([
    stop('A', { activities: [act('x', minutes)] }),
    stop('B', { leg: train('2026-09-16T14:00', '2026-09-16T17:00') }),
  ], { mode: 'transit' }));
  eq(mk(60).stops[0].freeMinutes, 240, 'finish 10:00, train 14:00 -> 4h free');
  eq(mk(60).stops[0].warnings, [], 'no warning when there is room');
  eq(mk(8 * 60).stops[0].warnings.includes('will-miss-departure'), true, 'finishing after the train leaves is flagged');
}

console.log('\n6. Day totals add up to the trip totals');
{
  const s = computeSchedule(trip([
    stop('A', { activities: [act('x', 90)] }),
    stop('B', { leg: car(300, 260), activities: [act('y', 120)] }),
    stop('C', { leg: car(150, 130) }),
  ]));
  eq(s.days.reduce((t, d) => t + d.travelMinutes, 0), s.totals.travelMinutes, 'per-day travel sums to the total');
  eq(s.days.reduce((t, d) => t + d.activityMinutes, 0), s.totals.activityMinutes, 'per-day activities sum to the total');
  eq(s.totals.travelMinutes, 390, 'travel = 260 + 130');
  eq(s.totals.activityMinutes, 210, 'activities = 90 + 120');
}

// ---------------------------------------------------------------------------
// Only the curfew limits the plan by default
// ---------------------------------------------------------------------------

console.log('\nA. The start time is kept as set');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(140, 120) })], { start: '2026-09-16T06:00' }));
  eq(at(s.stops[0].depart), '2026-09-16T06:00', 'set off at 06:00, as asked');
  eq(s.stops[0].notes, [], 'nothing to explain');
  eq(formatClock(s.stops[1].arrive), '08:00', 'arrive 08:00');

  const o = computeSchedule(trip([stop('A'), stop('B', { leg: car(140, 120) })], { start: '2026-09-16T06:00', settings: own }));
  eq(at(o.stops[0].depart), '2026-09-16T06:00', 'even with own hours from 09:00, the start is kept');
}

console.log('\nA2. A start inside the curfew waits for it to end, and says so');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(490, 7 * 60) })], { start: '2026-09-16T04:00' }));
  eq(at(s.stops[0].depart), '2026-09-16T05:00', 'set off at 05:00, when the curfew ends');
  eq(s.stops[0].notes, ['wait-curfew'], 'the card says it is the curfew');
  eq(formatClock(s.stops[1].arrive), '12:00', 'arrive 12:00 (the recommended break is not ticked)');
}

console.log('\nA3. Activities start on arrival — nothing waits for a "usual" morning');
{
  const s = computeSchedule(trip([
    stop('A', { activities: [act('x', 30)] }),
    stop('B', { leg: car(70, 60), activities: [act('y', 45)] }),
  ], { start: '2026-09-16T05:00' }));
  eq(formatClock(s.stops[0].activities[0].start), '05:00', 'at 05:00 at the start');
  eq(formatClock(s.stops[1].activities[0].start), '06:30', 'and at 06:30 on arrival');
}

console.log('\nA4. After a night, set off at the "morning" setting (05:00 by default)');
{
  const mk = (st: Settings) => computeSchedule(trip([
    stop('A', { overnight: true, activities: [act('x', 60)] }),
    stop('B', { leg: car(70, 60) }),
  ], { settings: st }));
  eq(at(mk(settings).stops[0].depart), '2026-09-17T05:00', 'default: 05:00 next day');
  eq(at(mk({ ...settings, morning: '07:30' }).stops[0].depart), '2026-09-17T07:30', 'or the time the traveller chose');
  eq(mk(settings).stops[0].nightHere, true, 'the card knows a night is spent here');
}

console.log('\nA5. The morning never beats the curfew: Donetsk oblast, 16:00–11:00');
{
  const s = computeSchedule(trip([
    stop('A', { region: 'UA-14', overnight: true }),
    stop('B', { region: 'UA-14', leg: car(70, 60) }),
  ], { start: '2026-09-16T12:00' }));
  eq(at(s.stops[0].depart), '2026-09-17T11:00', 'leave at 11:00, not 05:00');
}

console.log('\nB. A long drive: the curfew stops the car on the road, and that is flagged');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(1400, 20 * 60) })]));
  eq(s.stops[1].warnings.includes('overnight-en-route'), true, 'flagged as a night on the road');
  eq(at(s.stops[1].arrive), '2026-09-17T10:00', '09:00–24:00, then 05:00–10:00');
  eq(s.days.map(d => d.key), ['2026-09-16', '2026-09-17'], 'two calendar days');
}

console.log('\nB2. The same with own hours (09:00–20:00): three days, none skipped');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(2100, 30 * 60) })], { settings: own }));
  eq(s.days.map(d => d.key), ['2026-09-16', '2026-09-17', '2026-09-18'], 'three days, in order');
  eq(s.days.map(d => d.drivingMinutes), [660, 660, 480], '11h + 11h + 8h of driving');
}

console.log('\nC. A night at the start with nothing planned still counts as a day');
{
  const s = computeSchedule(trip([stop('A', { overnight: true }), stop('B', { leg: car(70, 60) })]));
  eq(s.days.map(d => d.key), ['2026-09-16', '2026-09-17'], 'both days present');
  eq(s.totals.days, 2, 'days = 2');
}

console.log('\nD. An activity is never cut in two by the curfew');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(900, 14 * 60 + 30), activities: [act('x', 120)] }),
  ]));
  eq(at(s.stops[1].arrive), '2026-09-16T23:30', 'arrive 23:30, half an hour before curfew');
  eq(at(s.stops[1].activities[0].start), '2026-09-17T05:00', 'it moves whole to when the curfew ends');
  eq(at(s.stops[1].activities[0].end), '2026-09-17T07:00', 'and keeps its two hours');
  eq(s.stops[1].warnings.includes('activity-moved'), true, 'flagged as moved');
}

console.log('\nD2. An evening activity is fine');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 630), activities: [act('x', 120)] }),
  ]));
  eq(at(s.stops[1].activitiesEnd), '2026-09-16T21:30', 'arrive 19:30, done at 21:30');
  eq(s.stops[1].warnings, [], 'nothing to warn about');
}

console.log('\nE. "Overnight" means one night, even when plans moved to the morning');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(900, 14 * 60 + 30), activities: [act('x', 120)], overnight: true }),
    stop('C', { leg: car(70, 60) }),
  ]));
  eq(at(s.stops[1].depart), '2026-09-17T07:00', 'leave after the 05:00–07:00 activity');
  eq(at(s.stops[2].arrive), '2026-09-17T08:00', 'not a day later');
}

console.log('\nF. Too late to go on before the curfew: the night is spent here, and said so');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(900, 825), activities: [act('x', 60)] }),
    stop('C', { leg: car(70, 60) }),
  ]));
  eq(at(s.stops[1].activitiesEnd), '2026-09-16T23:45', 'done at 23:45');
  eq(at(s.stops[1].depart), '2026-09-17T05:00', 'the next drive starts at 05:00');
  eq(s.stops[1].notes, ['night-curfew'], 'because of the curfew');

  const o = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 630), activities: [act('x', 60)] }),
    stop('C', { leg: car(70, 60) }),
  ], { settings: own }));
  eq(at(o.stops[1].depart), '2026-09-17T09:00', 'with own hours: 09:00');
  eq(o.stops[1].notes, ['night-limit'], 'because of the traveller\'s own limit');
}

console.log('\nF2. Most of a drive fits before the curfew: go, and the night on the road is flagged');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(420, 7 * 60), activities: [act('x', 120), act('y', 90)] }),
    stop('C', { leg: car(350, 5 * 60) }),
  ]));
  eq(at(s.stops[1].depart), '2026-09-16T19:30', '4.5h of 5h fit today: set off at 19:30');
  eq(s.stops[2].warnings.includes('overnight-en-route'), true, 'and the curfew catches the car — flagged');

  const o = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(420, 7 * 60), activities: [act('x', 120), act('y', 90)] }),
    stop('C', { leg: car(350, 5 * 60) }),
  ], { settings: own }));
  eq(at(o.stops[1].depart), '2026-09-17T09:00', 'with own hours only 30 min are left: go in the morning');
  eq(o.stops[2].warnings.includes('overnight-en-route'), false, 'no night on the road');
}

console.log('\nG. A stop without distance is flagged, not driven in zero minutes');
{
  const s = computeSchedule(trip([stop('Kyiv'), stop('Lviv', { leg: car(0, 0) })]));
  eq(s.stops[1].warnings.includes('leg-unknown'), true, 'flagged: distance unknown');
}

console.log('\nH. The clock change (25 Oct 2026) does not shift the hours by one');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(1000, 14 * 60) })], { start: '2026-10-25T09:00', settings: own }));
  eq(at(s.stops[1].arrive), '2026-10-26T12:00', '11h on the 25th (09–20), 3h on the 26th');
}

// ---------------------------------------------------------------------------
// Curfew
// ---------------------------------------------------------------------------

console.log('\nK1. The curfew stops the car: Kherson oblast, 21:00–05:00');
{
  const s = computeSchedule(trip([
    stop('A', { region: 'UA-65' }),
    stop('B', { region: 'UA-65', leg: car(900, 13 * 60) }),
  ]));
  eq(at(s.stops[1].arrive), '2026-09-17T06:00', '12h until 21:00, then 1h from 05:00');
  eq(s.stops[1].warnings.includes('overnight-en-route'), true, 'flagged');
}

console.log('\nK2. The stricter curfew of the two ends of a leg applies');
{
  // Kyiv (01:00–05:00) to Kherson oblast (21:00–05:00), only 1h of driving.
  const s = computeSchedule(trip([
    stop('Kyiv', { region: 'UA-30' }),
    stop('Kherson', { region: 'UA-65', leg: car(80, 60) }),
  ], { start: '2026-09-16T20:40' }));
  eq(at(s.stops[0].depart), '2026-09-17T05:00', '20 min before Kherson\'s 21:00 is too little: leave at 05:00');
  eq(s.stops[0].notes, ['night-curfew'], 'explained');
}

console.log('\nK3. No curfew in Zakarpattia and no own limit: drive through midnight');
{
  const s = computeSchedule(trip([
    stop('A', { region: 'UA-21' }),
    stop('B', { region: 'UA-21', leg: car(100, 120) }),
  ], { start: '2026-09-16T22:30' }));
  eq(at(s.stops[1].arrive), '2026-09-17T00:30', 'arrive 00:30');
  eq(s.stops[1].warnings, [], 'nothing to warn about');
}

console.log('\nK4. A train arriving during curfew is allowed, with a warning; plans wait for the curfew to end');
{
  const s = computeSchedule(trip([
    stop('Kyiv', { region: 'UA-30' }),
    stop('Lviv', { region: 'UA-46', leg: train('2026-09-16T22:00', '2026-09-17T03:10'), activities: [act('x', 30)] }),
  ], { mode: 'transit' }));
  eq(s.stops[1].warnings.includes('arrives-during-curfew'), true, 'flagged');
  eq(at(s.stops[1].activities[0].start), '2026-09-17T05:00', 'the plan starts at 05:00');
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

// ---------------------------------------------------------------------------
// Breaks: advice, and in the arrival time only when ticked
// ---------------------------------------------------------------------------

const eightHours = (opts: Partial<Stop> = {}, st: Settings = settings) =>
  computeSchedule(trip([stop('Kyiv'), stop('Lviv', { leg: car(560, 8 * 60), ...opts })], { settings: st }));

console.log('\nBR1. 8h at the wheel: a break is recommended after 4.5h, the arrival does not change');
{
  const s = eightHours();
  const b = s.stops[1].breaks;
  eq(b.length, 1, 'one break');
  eq(formatClock(b[0].at), '13:30', 'due at 13:30');
  eq(Math.round(b[0].km), 315, 'about 315 km in');
  eq([b[0].kind, b[0].minutes, b[0].taken], ['rest', 45, false], '45-minute rest, not ticked');
  eq(formatClock(s.stops[1].arrive), '17:00', 'arrival as if driving non-stop');
}

console.log('\nBR2. Ticked, the break is in the arrival time');
{
  const s = eightHours({ takenBreaks: [1] });
  eq(formatClock(s.stops[1].arrive), '17:45', 'arrive 45 min later');
  eq(s.days[0].travelMinutes, 525, 'the break counts as time on the road');
  eq(s.days[0].drivingMinutes, 480, 'but not as time at the wheel');
}

console.log('\nBR3. Two drivers: a 15-minute swap instead of a rest');
{
  const s = eightHours({ takenBreaks: [1] }, { ...settings, drivers: 2 });
  eq([s.stops[1].breaks[0].kind, s.stops[1].breaks[0].minutes], ['swap', 15], 'swap, 15 min');
  eq(formatClock(s.stops[1].arrive), '17:15', 'arrive 17:15');
}

console.log('\nBR4. Driving time adds up across short stops, and a long stop is a rest');
{
  const mk = (minutesAtB: number) => computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(230, 200), activities: [act('x', minutesAtB)] }),
    stop('C', { leg: car(230, 200) }),
  ]));
  const short = mk(20);
  eq(short.stops[1].breaks.length, 0, 'no break on the first 200 min');
  eq(short.stops[2].breaks.map(b => formatClock(b.at)), ['13:50'], 'after 20 min at B, a break is due 70 min later');
  eq(mk(60).stops[2].breaks.length, 0, 'an hour at B was a rest: nothing due');
}

console.log('\nBR5. More than 9h at the wheel in a day is pointed out — with one driver');
{
  eq(computeSchedule(trip([stop('A'), stop('B', { leg: car(700, 10 * 60) })])).days[0].longDriving, true, 'one driver, 10h: pointed out');
  eq(computeSchedule(trip([stop('A'), stop('B', { leg: car(700, 10 * 60) })], { settings: { ...settings, drivers: 2 } })).days[0].longDriving,
    false, 'two drivers: not');
  eq(eightHours().days[0].longDriving, false, '8h: not');
}

console.log('\nBR6. No break recommended minutes before arriving');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(330, 280) })]));
  eq(s.stops[1].breaks.length, 0, '4h40: the break would fall 10 min before arrival — not suggested');
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
