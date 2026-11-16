// Movement helpers that do not depend on WebGL (any object with position.{x,z} and rotation.y works).
export const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Mover {
  constructor(obj, { speed = 2, turnRate = 8 } = {}) {
    this.obj = obj; this.speed = speed; this.turnRate = turnRate;
    this.path = []; this.onDone = null; this.moving = false; this.traveled = 0;
  }
  teleport(p, yaw) { this.obj.position.x = p.x; this.obj.position.z = p.z; if (yaw !== undefined) this.obj.rotation.y = yaw; this.path = []; this.onDone = null; this.moving = false; }
  setPath(points, onDone = null) { this.path = points.map((p) => ({ x: p.x, z: p.z })); this.onDone = onDone; }
  get idle() { return this.path.length === 0; }
  update(dt) {
    if (!this.path.length) { this.moving = false; return; }
    const t = this.path[0]; const p = this.obj.position;
    const dx = t.x - p.x; const dz = t.z - p.z; const dist = Math.hypot(dx, dz); const step = this.speed * dt;
    if (dist > 0.05) this.obj.rotation.y = lerpAngle(this.obj.rotation.y, Math.atan2(dx, dz), Math.min(1, this.turnRate * dt));
    if (dist <= step) {
      p.x = t.x; p.z = t.z; this.traveled += dist; this.path.shift();
      if (!this.path.length) { this.moving = false; const cb = this.onDone; this.onDone = null; cb?.(); return; }
    } else { p.x += (dx / dist) * step; p.z += (dz / dist) * step; this.traveled += step; }
    this.moving = true;
  }
}
