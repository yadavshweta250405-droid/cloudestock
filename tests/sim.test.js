import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mover, lerpAngle } from '../frontend/js/three/sim.js';

test('Mover follows a path at constant speed, faces its direction and fires onDone once', () => {
  const obj = { position: { x: 0, z: 0 }, rotation: { y: 0 } };
  const m = new Mover(obj, { speed: 2 }); let done = 0;
  m.setPath([{ x: 10, z: 0 }, { x: 10, z: 10 }], () => { done++; });
  for (let i = 0; i < 110; i++) m.update(0.1);               // 10 s * 2 m/s = 20 m
  assert.equal(done, 1); assert.ok(m.idle); assert.ok(Math.abs(obj.position.x - 10) < 1e-9 && Math.abs(obj.position.z - 10) < 1e-9);
  assert.ok(Math.abs(m.traveled - 20) < 1e-6);
  m.update(0.1); assert.equal(done, 1); assert.equal(m.moving, false);
});
test('Mover turns the short way round and never overshoots a waypoint with large dt', () => {
  assert.ok(Math.abs(lerpAngle(3.0, -3.0, 1) - (Math.PI * 2 - 3.0)) < 1e-9);
  const obj = { position: { x: 0, z: 0 }, rotation: { y: 0 } }; const m = new Mover(obj, { speed: 50 });
  m.setPath([{ x: 1, z: 0 }]); m.update(5); assert.equal(obj.position.x, 1); assert.ok(m.idle);
  m.teleport({ x: 5, z: 5 }); assert.equal(obj.position.x, 5);
});
