import { computeSchedule } from '../src/schedule.ts';
import { formatMinutes, formatClock, isoLocal } from '../src/time.ts';
import type { Trip, Stop, Leg } from '../src/types.ts';

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
const stop = (name: string, opts: Partial<Stop> = {}): Stop => ({
  id: 's' + (++n), name, lat: 50, lon: 30, label: name,
  arrival: { kind: 'auto' }, overnight: false, activities: [], leg: null, ...opts,
});
const car = (km: number, minutes: number): Leg => ({ mode: 'car', source: 'manual', km, minutes });
const act = (title: string, minutes: number) => ({ id: 'a' + (++n), title, minutes });

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
  eq(formatClock(s.stops[1].arrive), '12:15', 'then 1h drive -> 12:15');
  eq(formatMinutes(135), '2h15', '135 minutes reads as 2h15, not 2.25');
}

console.log('\n3. The day window pauses driving overnight');
{
  const s = computeSchedule(trip([stop('A'), stop('B', { leg: car(1400, 20 * 60) })]));
  eq(s.stops[1].warnings.includes('overnight-en-route'), true, 'flagged as overnight en route');
  eq(s.totals.travelMinutes, 20 * 60, 'total driving still exactly 20h');
  eq(s.totals.days >= 2, true, 'spans at least two days');
}

console.log('\n4. Transit: times come from the timetable, and there is no km');
{
  const leg: Leg = { mode: 'transit', kind: 'train', departAt: '2026-09-16T14:30', arriveAt: '2026-09-16T19:05' };
  const s = computeSchedule(trip([
    stop('A', { activities: [act('lunch', 60)] }),
    stop('B', { leg }),
  ], { mode: 'transit' }));
  eq(formatClock(s.stops[1].arrive), '19:05', 'arrival is the timetable arrival');
  eq(s.totals.km, 0, 'no kilometres anywhere');
  eq('km' in leg, false, 'a transit leg has no km field at all');
  eq(s.totals.travelMinutes, 275, 'travel = 4h35 from the timetable');
}

console.log('\n5. Free time before a departure, and the warning when it is negative');
{
  const mk = (lunch: number) => computeSchedule(trip([
    stop('A', { activities: [act('lunch', lunch)] }),
    stop('B', { leg: { mode: 'transit', kind: 'train', departAt: '2026-09-16T14:00', arriveAt: '2026-09-16T17:00' } }),
  ], { mode: 'transit' }));

  const roomy = mk(60);
  eq(roomy.stops[0].freeMinutes, 240, 'finish 10:00, train 14:00 -> 4h free');
  eq(formatMinutes(roomy.stops[0].freeMinutes), '4h', 'shown as 4h');
  eq(roomy.stops[0].warnings, [], 'no warning when there is room');

  const tight = mk(8 * 60);
  eq(tight.stops[0].freeMinutes! < 0, true, 'finishing after the train leaves goes negative');
  eq(tight.stops[0].warnings.includes('will-miss-departure'), true, 'and is flagged');
}

console.log('\n6. Overnight stay moves departure to the next morning');
{
  const s = computeSchedule(trip([
    stop('A', { overnight: true, activities: [act('walk', 60)] }),
    stop('B', { leg: car(70, 60) }),
  ]));
  eq(isoLocal(s.stops[0].depart), '2026-09-17T09:00', 'leaves next day at dayStart');
  eq(formatClock(s.stops[1].arrive), '10:00', 'and arrives an hour later');
}

console.log('\n7. A pinned arrival earlier than travel allows is flagged, not silently used');
{
  const s = computeSchedule(trip([
    stop('A'),
    stop('B', { leg: car(700, 600), arrival: { kind: 'pinned', at: '2026-09-16T10:00' } }),
  ]));
  eq(s.stops[1].warnings.includes('pinned-earlier-than-possible'), true, 'flagged');
  eq(formatClock(s.stops[1].arrive), '10:00', 'but the pin still wins');
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

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
