import * as THREE from 'three/webgpu';
import { hideInstancedSlot } from './scene-culling.js';

const CELL_SIZE = 16;
const STORAGE_KEY = 'nyc-persistent-destruction-v1';

function createProceduralSmokeTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const hash = (x, y) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return h - Math.floor(h);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y) => {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < 5; i++) {
      v += amp * noise(x * freq, y * freq);
      freq *= 2.03;
      amp *= 0.5;
    }
    return v;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      const angle = Math.atan2(ny, nx);
      const lobe =
        0.16 * Math.sin(angle * 3 + 0.7) +
        0.11 * Math.cos(angle * 5 - 1.2) +
        0.07 * Math.sin(angle * 7 + 2.1);
      const r = Math.hypot(nx, ny) / Math.max(0.35, 0.88 + lobe);
      if (r >= 1.0) continue;

      const falloff = Math.pow(1 - r * r, 1.85);
      const n1 = fbm(nx * 2.8 + 4.3, ny * 2.8 + 7.1);
      const n2 = fbm(nx * 5.6 + n1 * 1.8, ny * 5.6 - n1 * 1.8);
      const density = Math.max(0, Math.min(1, falloff * (0.45 + 0.75 * n2)));

      const shade = Math.floor(175 + 65 * n1 - 35 * Math.max(0, ny));
      const idx = (y * size + x) * 4;
      data[idx] = shade;
      data[idx + 1] = shade;
      data[idx + 2] = shade + 6;
      data[idx + 3] = Math.floor(density * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createProceduralFlameTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const hash = (x, y) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return h - Math.floor(h);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y) => {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < 4; i++) {
      v += amp * noise(x * freq, y * freq);
      freq *= 2.1;
      amp *= 0.5;
    }
    return v;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      const taper = 0.58 + 0.38 * ((ny + 1) * 0.5);
      const turb = (fbm(nx * 3.5 + 2.1, ny * 4.5 + 5.7) - 0.5) * 0.42;
      const rx = (nx + turb * (1 - ny * 0.4)) / taper;
      const ry = ny;
      const r = Math.hypot(rx, ry);
      if (r >= 1.0) continue;

      const n = fbm(nx * 4.8 + 8.2, ny * 6.2 + 1.9);
      const core = Math.pow(Math.max(0, 1 - r), 1.65) * (0.55 + 0.65 * n);
      const alpha = Math.min(1, core * 1.35);

      const heat = Math.min(1, core * 1.4);
      const red = Math.min(255, Math.floor(255 * Math.min(1, heat * 1.8)));
      const green = Math.min(255, Math.floor(255 * Math.pow(heat, 1.55) * 0.92));
      const blue = Math.min(255, Math.floor(255 * Math.pow(heat, 3.2) * 0.75));

      const idx = (y * size + x) * 4;
      data[idx] = red;
      data[idx + 1] = green;
      data[idx + 2] = blue;
      data[idx + 3] = Math.floor(alpha * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class DestructionSystem {
  constructor(scene, streetDetails, reportCollision) {
    this.scene = scene;
    this.streetDetails = streetDetails;
    this.treeField = streetDetails.treeField;
    this.reportCollision = reportCollision;

    this.group = new THREE.Group();
    this.group.name = 'DestructionSystem';
    this.scene.add(this.group);

    this.cells = new Map();
    this.allProps = [];
    this.fallingProps = [];
    this.swayingTrees = [];
    this.debrisList = [];
    this.plumes = [];
    this.geysers = [];
    this.smokeEmitters = new Map();
    this.damagedTrafficOverlays = new Map();
    this.wallCracks = [];
    this.collapsingBuildings = [];
    this.roadCraters = [];

    // Persistent records saved to localStorage across restarts
    this.savedState = {
      version: 1,
      destroyedProps: [], // [{ id, fx, fz, speed }]
      buildingBreaches: [], // [{ x, y, z, nx, nz, impact }]
      roadCraters: [], // [{ x, z, impact }]
      stats: {
        propsDestroyed: 0,
        pedestriansStruck: 0,
        pedestriansHurt: 0,
        pedestriansKilled: 0,
        buildingsDamaged: 0,
        roadsBroken: 0,
      },
    };
    this._savePending = false;
    this._saveTimer = 0;

    this.brokenObjectsCount = 0;
    this.pedestriansStruckCount = 0;
    this.stats = {
      propsDestroyed: 0,
      pedestriansStruck: 0,
      pedestriansHurt: 0,
      pedestriansKilled: 0,
      buildingsDamaged: 0,
      roadsBroken: 0,
    };
    this.lastImpactLabel = '';
    this.lastImpactTimer = 0;

    this._initMaterials();
    this._indexProps(streetDetails.destructibles || []);
    this._restorePersistentState();
  }

  _initMaterials() {
    // Crafted architectural & mechanical geometries (no raw low-poly spheres/dodecahedrons)
    const glassShardGeo = new THREE.BoxGeometry(0.32, 0.018, 0.24);
    const branchStickGeo = new THREE.CylinderGeometry(0.032, 0.068, 0.95, 7);
    const leafClusterGeo = new THREE.PlaneGeometry(0.52, 0.52);
    const sparkStreakGeo = new THREE.BoxGeometry(0.035, 0.035, 0.58);
    const tireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.24, 16);
    tireGeo.rotateZ(Math.PI * 0.5);
    const bumperGeo = new THREE.BoxGeometry(1.48, 0.18, 0.24);
    const rebarGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6);

    this.geoms = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      taperedTrunk: new THREE.CylinderGeometry(0.34, 0.52, 1, 10),
      cone: new THREE.ConeGeometry(0.6, 1, 10),
      shard: glassShardGeo,
      branch: branchStickGeo,
      leaf: leafClusterGeo,
      sparkStreak: sparkStreakGeo,
      tire: tireGeo,
      bumper: bumperGeo,
      rebar: rebarGeo,
      plane: new THREE.PlaneGeometry(1, 1),
      circle: new THREE.CircleGeometry(1, 18),
    };

    const smokeTex = createProceduralSmokeTexture();
    const flameTex = createProceduralFlameTexture();

    const blackSmokeOpacities = [0.68, 0.52, 0.36, 0.20, 0.08];
    this.blackSmokeMats = blackSmokeOpacities.map(
      (op, idx) =>
        new THREE.MeshBasicNodeMaterial({
          map: smokeTex,
          color: idx === 0 ? 0x111317 : idx === 1 ? 0x16191f : 0x1d2129,
          transparent: true,
          opacity: op,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
    );

    const dustMistOpacities = [0.48, 0.36, 0.24, 0.14, 0.06];
    this.dustSmokeMats = dustMistOpacities.map(
      (op) =>
        new THREE.MeshBasicNodeMaterial({
          map: smokeTex,
          color: 0xb8c2cc,
          transparent: true,
          opacity: op,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
    );

    const fireOpacities = [0.95, 0.82, 0.64, 0.42, 0.18];
    const fireColors = [0xfffbeb, 0xfde047, 0xfb923c, 0xea580c, 0xb91c1c];
    this.firePlumeMats = fireOpacities.map(
      (op, idx) =>
        new THREE.MeshBasicNodeMaterial({
          map: flameTex,
          color: fireColors[idx],
          transparent: true,
          opacity: op,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
    );

    this.mats = {
      woodBark: new THREE.MeshStandardNodeMaterial({ color: 0x4b3828, roughness: 0.92 }),
      woodSplinter: new THREE.MeshStandardNodeMaterial({ color: 0xc49a62, roughness: 0.85 }),
      leafGreen: new THREE.MeshStandardNodeMaterial({ color: 0x3f6e28, roughness: 0.78, side: THREE.DoubleSide }),
      leafGold: new THREE.MeshStandardNodeMaterial({ color: 0xc28124, roughness: 0.78, side: THREE.DoubleSide }),
      poleMetal: new THREE.MeshStandardNodeMaterial({ color: 0x363b42, roughness: 0.38, metalness: 0.78 }),
      pedPostMetal: new THREE.MeshStandardNodeMaterial({ color: 0x1b1f24, roughness: 0.35, metalness: 0.82 }),
      signalYellow: new THREE.MeshStandardNodeMaterial({ color: 0xd99b1a, roughness: 0.4, metalness: 0.35 }),
      hydrantRed: new THREE.MeshStandardNodeMaterial({ color: 0xb02720, roughness: 0.38, metalness: 0.52 }),
      mailboxBlue: new THREE.MeshStandardNodeMaterial({ color: 0x1b3b73, roughness: 0.36, metalness: 0.58 }),
      cartSteel: new THREE.MeshStandardNodeMaterial({ color: 0xd0d7de, roughness: 0.24, metalness: 0.88 }),
      umbrellaBlue: new THREE.MeshStandardNodeMaterial({ color: 0x1d4ed8, roughness: 0.65 }),
      umbrellaYellow: new THREE.MeshStandardNodeMaterial({ color: 0xeab308, roughness: 0.65 }),
      orangeStripe: new THREE.MeshStandardNodeMaterial({ color: 0xea580c, roughness: 0.55 }),
      whiteStripe: new THREE.MeshStandardNodeMaterial({ color: 0xf1f5f9, roughness: 0.6 }),
      concrete: new THREE.MeshStandardNodeMaterial({ color: 0x8e8a82, roughness: 0.92 }),
      limestone: new THREE.MeshStandardNodeMaterial({ color: 0xbcb4a5, roughness: 0.86 }),
      mortar: new THREE.MeshStandardNodeMaterial({ color: 0xa6a198, roughness: 0.95 }),
      brick: new THREE.MeshStandardNodeMaterial({ color: 0x8b3a2b, roughness: 0.9 }),
      brickDark: new THREE.MeshStandardNodeMaterial({ color: 0x63281e, roughness: 0.92 }),
      steelGirder: new THREE.MeshStandardNodeMaterial({ color: 0x2c323b, roughness: 0.42, metalness: 0.82 }),
      rustedRebar: new THREE.MeshStandardNodeMaterial({ color: 0x5c3424, roughness: 0.68, metalness: 0.65 }),
      asphaltTop: new THREE.MeshStandardNodeMaterial({ color: 0x23272e, roughness: 0.88 }),
      asphaltSubbase: new THREE.MeshStandardNodeMaterial({ color: 0x45433e, roughness: 0.95 }),
      roadPaintYellow: new THREE.MeshStandardNodeMaterial({ color: 0xeab308, roughness: 0.62 }),
      breachCavity: new THREE.MeshBasicNodeMaterial({ color: 0x07080b, side: THREE.DoubleSide }),
      charcoal: new THREE.MeshStandardNodeMaterial({ color: 0x1a1d22, roughness: 0.68, metalness: 0.35 }),
      taxiYellow: new THREE.MeshStandardNodeMaterial({ color: 0xffbe14, roughness: 0.25, metalness: 0.35 }),
      glassShard: new THREE.MeshStandardNodeMaterial({
        color: 0xdbeafe,
        emissive: 0x60a5fa,
        emissiveIntensity: 0.25,
        roughness: 0.1,
        metalness: 0.25,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      spark: new THREE.MeshBasicNodeMaterial({ color: 0xffd866 }),
      waterDrop: new THREE.MeshStandardNodeMaterial({
        color: 0xd8f3ff,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.18,
        roughness: 0.12,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
      crackDecal: new THREE.MeshBasicNodeMaterial({
        map: smokeTex,
        color: 0x090a0d,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };

    // Pre-warm all destruction & volumetric plume materials so precompileShaders() compiles them before frame 1
    let idx = 0;
    const allMats = [
      ...Object.values(this.mats),
      ...this.blackSmokeMats,
      ...this.dustSmokeMats,
      ...this.firePlumeMats,
    ];
    for (const mat of allMats) {
      const warm = new THREE.Mesh(this.geoms.plane, mat);
      warm.scale.setScalar(0.0001);
      warm.position.set(idx * 0.01, -40, 0);
      this.group.add(warm);
      idx++;
    }
  }

  _cellKey(x, z) {
    return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
  }

  _indexProps(destructibles) {
    this.allProps = destructibles;
    for (let i = 0; i < destructibles.length; i++) {
      const p = destructibles[i];
      p._persistId = i;
      const k = this._cellKey(p.x, p.z);
      let list = this.cells.get(k);
      if (!list) {
        list = [];
        this.cells.set(k, list);
      }
      list.push(p);
    }
  }

  _scheduleSave() {
    this._savePending = true;
  }

  _flushSave() {
    if (!this._savePending) return;
    this._savePending = false;
    try {
      this.savedState.stats = { ...this.stats };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedState));
    } catch {
      /* Storage full or unavailable */
    }
  }

  _restorePersistentState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return;

      // Restore destroyed street props & fallen trees/poles in their settled resting state
      if (Array.isArray(parsed.destroyedProps)) {
        for (const item of parsed.destroyedProps) {
          const prop = this.allProps[item.id];
          if (prop && !prop.destroyed) {
            this.destroyProp(prop, item.fx || 1, item.fz || 0, item.speed || 8, false, true);
          }
        }
      }

      // Restore breached building walls & rubble piles
      if (Array.isArray(parsed.buildingBreaches)) {
        for (const b of parsed.buildingBreaches) {
          this._spawnBuildingBreachAndRubble(b.x, b.y, b.z, b.nx, b.nz, b.impact, true);
          this.savedState.buildingBreaches.push(b);
        }
      }

      // Restore fractured road craters
      if (Array.isArray(parsed.roadCraters)) {
        for (const rc of parsed.roadCraters) {
          this.damageRoadSurface(rc.x, rc.z, rc.impact, false, true);
        }
      }

      // Restore cumulative counters
      if (parsed.stats) {
        this.stats.propsDestroyed = Math.max(this.stats.propsDestroyed, parsed.stats.propsDestroyed || 0);
        this.stats.pedestriansStruck = Math.max(this.stats.pedestriansStruck, parsed.stats.pedestriansStruck || 0);
        this.stats.pedestriansHurt = Math.max(this.stats.pedestriansHurt, parsed.stats.pedestriansHurt || 0);
        this.stats.pedestriansKilled = Math.max(this.stats.pedestriansKilled, parsed.stats.pedestriansKilled || 0);
        this.stats.buildingsDamaged = Math.max(this.stats.buildingsDamaged, parsed.stats.buildingsDamaged || 0);
        this.stats.roadsBroken = Math.max(this.stats.roadsBroken, parsed.stats.roadsBroken || 0);
        this.brokenObjectsCount = this.stats.propsDestroyed;
        this.pedestriansStruckCount = this.stats.pedestriansStruck;
      }
    } catch (e) {
      console.warn('[DestructionSystem] Failed to restore persistent state:', e);
    }
  }

  resetWorldDestruction() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  }

  getEntityRadius(mode) {
    switch (mode) {
      case 'car':
      case 'traffic':
        return 1.38;
      case 'helicopter':
        return 2.4;
      case 'cyclist':
        return 0.65;
      case 'person':
      default:
        return 0.48;
    }
  }

  checkEntityPropCollisions(entity, mode, dt, isPlayer = false) {
    if (!entity || !entity.position) return;
    const pos = entity.position;
    if (pos.y > 9.5) return;

    const ex = pos.x;
    const ez = pos.z;
    const ey = pos.y;
    const entityRadius = this.getEntityRadius(mode);

    const minCx = Math.floor((ex - entityRadius - 2.5) / CELL_SIZE);
    const maxCx = Math.floor((ex + entityRadius + 2.5) / CELL_SIZE);
    const minCz = Math.floor((ez - entityRadius - 2.5) / CELL_SIZE);
    const maxCz = Math.floor((ez + entityRadius + 2.5) / CELL_SIZE);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const list = this.cells.get(`${cx},${cz}`);
        if (!list) continue;

        for (let i = 0; i < list.length; i++) {
          const prop = list[i];
          if (prop.destroyed) continue;
          if (ey > (prop.height || 4.5) + 1.2) continue;

          const dx = ex - prop.x;
          const dz = ez - prop.z;
          const minDist = entityRadius + (prop.radius || 0.4);
          const d2 = dx * dx + dz * dz;
          if (d2 >= minDist * minDist) continue;

          const dist = Math.sqrt(d2) || 0.001;
          const nx = dx / dist;
          const nz = dz / dist;

          const rawSpeed = Math.abs(entity.speed || 0);
          const kvx = entity.vx || 0;
          const kvz = entity.vz || 0;
          const kSpeed = Math.hypot(kvx, kvz);
          const sign = (entity.speed || 0) < -0.1 ? -1 : 1;
          const fwdX = Math.sin(entity.heading || 0) * sign;
          const fwdZ = Math.cos(entity.heading || 0) * sign;
          const moveSpeed = Math.max(rawSpeed, kSpeed, mode === 'person' ? 3.0 : 4.2);

          const hitDirX = rawSpeed >= kSpeed ? fwdX : kvx / (kSpeed || 1);
          const hitDirZ = rawSpeed >= kSpeed ? fwdZ : kvz / (kSpeed || 1);

          const overlap = minDist - dist;
          pos.x += nx * overlap * 0.72;
          pos.z += nz * overlap * 0.72;

          // Trees react dynamically based on impact energy: light bumps shudder & shed leaves; harder impacts crack and topple the real procedural tree
          if (prop.kind === 'tree' && (mode === 'person' || (moveSpeed < 4.8 && !prop._crackedOnce))) {
            prop._crackedOnce = true;
            this._triggerTreeShudderReaction(prop, hitDirX - nx * 0.35, hitDirZ - nz * 0.35, moveSpeed, isPlayer);
          } else {
            this.destroyProp(prop, hitDirX - nx * 0.35, hitDirZ - nz * 0.35, moveSpeed, isPlayer, false);
          }

          // Equal & opposite Newton's 3rd Law reaction on the colliding vehicle/character
          const massRatio = this._getPropResistance(prop.kind, mode);
          const recoil = Math.max(2.0, moveSpeed * massRatio * 1.15);
          entity.vx = (entity.vx || 0) + nx * recoil;
          entity.vz = (entity.vz || 0) + nz * recoil;
          if (typeof entity.speed === 'number') {
            entity.speed *= Math.max(0.15, 1.0 - massRatio * 0.88);
          }
          if (typeof entity.angularVel === 'number') {
            const cross = dx * hitDirZ - dz * hitDirX;
            entity.angularVel += Math.sign(cross || 1) * Math.min(3.8, recoil * 0.35);
          }
          if (entity.pitchVel !== undefined) {
            entity.pitchVel += 0.18 * Math.min(2.0, moveSpeed * 0.15);
            entity.heaveVel = (entity.heaveVel || 0) + 0.22;
          }

          this.applyEntityDamage(
            entity,
            mode,
            moveSpeed * (0.58 + massRatio),
            prop.x,
            Math.max(0.5, ey + 0.5),
            prop.z,
            nx,
            nz,
            isPlayer,
            false
          );

          const soundKind = this._getPropSoundKind(prop.kind);
          if (this.reportCollision) {
            this.reportCollision(
              soundKind,
              prop.x,
              Math.max(0.4, ey),
              prop.z,
              Math.max(3.5, moveSpeed * 1.25)
            );
          }
        }
      }
    }
  }

  _getPropResistance(kind, mode) {
    const base =
      {
        tree: 0.56,
        signal: 0.44,
        lamp: 0.38,
        pedLamp: 0.30,
        cart: 0.46,
        steam: 0.34,
        hydrant: 0.36,
        mailbox: 0.30,
      }[kind] || 0.35;

    if (mode === 'person') return Math.min(0.88, base * 1.5);
    if (mode === 'cyclist') return Math.min(0.82, base * 1.28);
    if (mode === 'helicopter') return base * 0.72;
    return base;
  }

  _getPropSoundKind(kind) {
    switch (kind) {
      case 'tree':
        return 'tree';
      case 'hydrant':
        return 'hydrant';
      case 'lamp':
      case 'pedLamp':
      case 'signal':
        return 'lamp';
      case 'cart':
      case 'steam':
      case 'mailbox':
      default:
        return 'prop';
    }
  }

  _getPropLabel(kind) {
    switch (kind) {
      case 'tree':
        return 'TREE';
      case 'lamp':
        return 'STREETLIGHT';
      case 'pedLamp':
        return 'LAMP POST';
      case 'signal':
        return 'TRAFFIC SIGNAL';
      case 'hydrant':
        return 'FIRE HYDRANT';
      case 'mailbox':
        return 'MAILBOX';
      case 'cart':
        return 'FOOD CART';
      case 'steam':
        return 'STEAM STACK';
      default:
        return 'STREET PROP';
    }
  }

  /**
   * Builds a 1-instance InstancedMesh using the ACTUAL procedural NYC tree geometry and leaf-atlas TSL shader
   * from `trees.js`, so damaged/swaying/falling trees look 100% authentic (never low-poly primitives).
   */
  _createRealTreeMesh(prop) {
    if (!this.treeField || !this.treeField.geos || !this.treeField.material) return null;
    const sp = Math.min(2, Math.max(0, prop.species || 0));
    const variant = prop.variant ? 1 : 0;
    const srcGeo =
      this.treeField.geos[sp]?.[variant]?.[0] ||
      this.treeField.geos[sp]?.[variant]?.[1];
    if (!srcGeo) return null;

    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(srcGeo.attributes)) {
      geo.setAttribute(name, srcGeo.attributes[name]);
    }
    geo.setIndex(srcGeo.index);
    geo.boundingSphere = srcGeo.boundingSphere;
    geo.boundingBox = srcGeo.boundingBox;

    const td = prop.treeData || [0.35, 0.55, 0.25, sp + 0.25];
    const treeDataAttr = new THREE.InstancedBufferAttribute(new Float32Array(td), 4);
    geo.setAttribute('aTreeData', treeDataAttr);

    const mesh = new THREE.InstancedMesh(geo, this.treeField.material, 1);
    mesh.count = 1;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const s = prop.scale || 1.0;
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, prop.yaw || 0, 0);
    dummy.scale.set(prop.sx || s, prop.sy || s, prop.sz || s);
    dummy.updateMatrix();
    mesh.setMatrixAt(0, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /**
   * Builds a detailed splintered tree stump with bark outer ring, pale heartwood core, and jagged vertical wood splinters.
   */
  _createSplinteredTreeStump(s = 1.0) {
    const stumpGroup = new THREE.Group();
    const outerBark = new THREE.Mesh(this.geoms.taperedTrunk, this.mats.woodBark);
    outerBark.scale.set(0.32 * s, 0.42 * s, 0.32 * s);
    outerBark.position.y = 0.21 * s;
    stumpGroup.add(outerBark);

    const heartwood = new THREE.Mesh(this.geoms.cyl, this.mats.woodSplinter);
    heartwood.scale.set(0.24 * s, 0.45 * s, 0.24 * s);
    heartwood.position.y = 0.22 * s;
    stumpGroup.add(heartwood);

    // Jagged torn wood fibers around the fracture rim
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2;
      const spike = new THREE.Mesh(this.geoms.cone, i % 2 === 0 ? this.mats.woodSplinter : this.mats.woodBark);
      const h = (0.18 + (i % 3) * 0.08) * s;
      spike.scale.set(0.06 * s, h, 0.05 * s);
      spike.position.set(Math.cos(ang) * 0.1 * s, (0.4 + h * 0.4) * s, Math.sin(ang) * 0.1 * s);
      spike.rotation.y = ang;
      spike.rotation.z = (Math.random() - 0.5) * 0.22;
      stumpGroup.add(spike);
    }
    return stumpGroup;
  }

  _triggerTreeShudderReaction(prop, dirX, dirZ, impactSpeed, isPlayer) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len;
    const fz = dirZ / len;
    const s = prop.scale || 1.0;
    const leafMat = prop.species === 1 ? this.mats.leafGold : this.mats.leafGreen;

    if (isPlayer) {
      this.lastImpactLabel = 'TREE SHUDDERED — BARK CRACKED';
      this.lastImpactTimer = 2.0;
    }

    // Hide static instance and replace with a live swaying real-geometry tree so the whole canopy rocks on impact
    if (!prop._swayGroup && this.treeField && typeof this.treeField.destroyTree === 'function') {
      const realMesh = this._createRealTreeMesh(prop);
      if (realMesh) {
        this.treeField.destroyTree(prop.treeIndex, prop.cell);
        const swayPivot = new THREE.Group();
        swayPivot.position.set(prop.x, prop.y || 0.2, prop.z);
        swayPivot.add(realMesh);
        this.group.add(swayPivot);
        prop._swayGroup = swayPivot;
        const entry = {
          prop,
          pivot: swayPivot,
          fx,
          fz,
          amp: Math.min(0.24, 0.08 + impactSpeed * 0.025),
          phase: 0,
          decay: 1.85,
        };
        prop._swayEntry = entry;
        this.swayingTrees.push(entry);
      }
    } else if (prop._swayEntry) {
      prop._swayEntry.fx = fx;
      prop._swayEntry.fz = fz;
      prop._swayEntry.amp = Math.min(0.28, prop._swayEntry.amp + 0.12);
      prop._swayEntry.phase = 0;
    }

    // Shed fluttering leaves and small bark twigs from the canopy
    this._spawnFlutteringLeaves(prop.x, 3.2 * s, prop.z, fx, fz, 16, leafMat);
    this.spawnDebrisBurst(prop.x, 1.4 * s, prop.z, fx, fz, impactSpeed * 0.7, {
      count: 5,
      matA: this.mats.woodBark,
      matB: this.mats.woodSplinter,
      geom: this.geoms.branch,
      scaleMin: 0.22,
      scaleMax: 0.48,
      persistent: true,
    });
  }

  destroyProp(prop, dirX, dirZ, impactSpeed, isPlayer = false, isRestoring = false) {
    if (prop.destroyed) return;
    prop.destroyed = true;
    this.brokenObjectsCount++;
    this.stats.propsDestroyed = this.brokenObjectsCount;

    if (isPlayer && !isRestoring) {
      this.lastImpactLabel = `${this._getPropLabel(prop.kind)} SMASHED`;
      this.lastImpactTimer = 2.6;
    }

    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len;
    const fz = dirZ / len;
    const speed = Math.max(4.5, impactSpeed);

    if (!isRestoring && prop._persistId !== undefined) {
      this.savedState.destroyedProps.push({
        id: prop._persistId,
        fx: Math.round(fx * 100) / 100,
        fz: Math.round(fz * 100) / 100,
        speed: Math.round(speed * 10) / 10,
      });
      this._scheduleSave();
    }

    if (prop.kind === 'tree') {
      if (prop._swayGroup) {
        this.group.remove(prop._swayGroup);
        prop._swayGroup = null;
      }
      if (this.treeField && typeof this.treeField.destroyTree === 'function') {
        this.treeField.destroyTree(prop.treeIndex, prop.cell);
      }
    } else if (prop.slots) {
      for (const s of prop.slots) {
        hideInstancedSlot(s.mesh, s.index);
      }
    }

    if (prop.lightSite) prop.lightSite.disabled = true;
    if (prop.light) prop.light.disabled = true;

    this._spawnBrokenPropVisuals(prop, fx, fz, speed, isRestoring);
  }

  _spawnBrokenPropVisuals(prop, fx, fz, speed, isRestoring = false) {
    const { x, z, kind } = prop;

    if (kind === 'tree') {
      const s = prop.scale || 1.0;
      const baseY = prop.y || 0.2;

      // 1. Permanent splintered bark & heartwood stump rooted in the sidewalk tree pit
      const stump = this._createSplinteredTreeStump(s);
      stump.position.set(x, baseY, z);
      this.group.add(stump);

      // 2. Real procedural NYC tree geometry & leaf-atlas crown hinged at the fractured trunk
      const pivot = new THREE.Group();
      pivot.position.set(x, baseY + 0.32 * s, z);

      const realTreeMesh = this._createRealTreeMesh(prop);
      if (realTreeMesh) {
        realTreeMesh.position.y = -0.28 * s;
        pivot.add(realTreeMesh);
      }

      // Exposed pale heartwood fracture plug at the base of the fallen trunk
      const fracturePlug = new THREE.Mesh(this.geoms.cone, this.mats.woodSplinter);
      fracturePlug.scale.set(0.24 * s, 0.45 * s, 0.24 * s);
      fracturePlug.rotation.x = Math.PI;
      fracturePlug.position.y = 0.05 * s;
      pivot.add(fracturePlug);

      const leafMat = prop.species === 1 ? this.mats.leafGold : this.mats.leafGreen;
      const restTilt = Math.PI * 0.465;

      if (isRestoring) {
        pivot.rotation.order = 'YXZ';
        pivot.rotation.z = -fx * restTilt;
        pivot.rotation.x = fz * restTilt;
        pivot.position.x += fx * 0.45;
        pivot.position.z += fz * 0.45;
        this.group.add(pivot);
        return;
      }

      this.group.add(pivot);
      this.fallingProps.push({
        group: pivot,
        fx,
        fz,
        vx: fx * Math.min(4.8, speed * 0.22),
        vz: fz * Math.min(4.8, speed * 0.22),
        vy: Math.min(1.6, speed * 0.09),
        tiltAngle: prop._swayEntry ? Math.max(0.08, prop._swayEntry.amp) : 0.05,
        tiltVel: Math.max(1.35, speed * 0.20),
        restTilt,
        settled: false,
        groundBurstDone: false,
        burstKind: 'tree',
        poleHeight: Math.max(4.2, (prop.height || 5.5) * 0.72),
        leafMat,
      });

      // Spawn natural snapped wooden limbs & fluttering leaves
      this.spawnDebrisBurst(x, 1.3 * s, z, fx, fz, speed * 0.85, {
        count: 8,
        matA: this.mats.woodSplinter,
        matB: this.mats.woodBark,
        geom: this.geoms.branch,
        scaleMin: 0.35,
        scaleMax: 0.85,
        persistent: true,
      });
      this._spawnFlutteringLeaves(x, 3.2 * s, z, fx, fz, 24, leafMat);
      return;
    }

    if (kind === 'lamp' || kind === 'pedLamp' || kind === 'signal') {
      const shearedBase = new THREE.Mesh(this.geoms.cyl, this.mats.poleMetal);
      shearedBase.scale.set(0.24, 0.18, 0.24);
      shearedBase.position.set(x, 0.09, z);
      this.group.add(shearedBase);

      const pivot = new THREE.Group();
      pivot.position.set(x, 0.14, z);

      const h = kind === 'pedLamp' ? 3.9 : 6.8;
      const poleMat = kind === 'pedLamp' ? this.mats.pedPostMetal : this.mats.poleMetal;
      const pole = new THREE.Mesh(this.geoms.taperedTrunk, poleMat);
      pole.scale.set(0.18, h, 0.18);
      pole.position.y = h * 0.5;
      pivot.add(pole);

      if (kind === 'pedLamp') {
        const capital = new THREE.Mesh(this.geoms.cyl, poleMat);
        capital.scale.set(0.26, 0.22, 0.26);
        capital.position.y = h;
        pivot.add(capital);

        const luminaire = new THREE.Mesh(this.geoms.cyl, this.mats.glassShard);
        luminaire.scale.set(0.36, 0.48, 0.36);
        luminaire.position.y = h + 0.26;
        pivot.add(luminaire);
      } else {
        const arm = new THREE.Mesh(this.geoms.cyl, poleMat);
        arm.scale.set(0.09, 2.6, 0.09);
        arm.rotation.z = Math.PI * 0.47;
        arm.position.set(1.25, h - 0.18, 0);
        pivot.add(arm);

        if (kind === 'signal') {
          const housing = new THREE.Mesh(this.geoms.box, this.mats.signalYellow);
          housing.scale.set(0.34, 0.96, 0.34);
          housing.position.set(2.25, h - 0.72, 0);
          pivot.add(housing);
        } else {
          const cobra = new THREE.Mesh(this.geoms.box, poleMat);
          cobra.scale.set(0.62, 0.14, 0.28);
          cobra.position.set(2.35, h - 0.22, 0);
          pivot.add(cobra);
        }
      }

      const restTilt = Math.PI * 0.485;
      if (isRestoring) {
        pivot.rotation.order = 'YXZ';
        pivot.rotation.z = -fx * restTilt;
        pivot.rotation.x = fz * restTilt;
        pivot.position.x += fx * 0.6;
        pivot.position.z += fz * 0.6;
        this.group.add(pivot);
        return;
      }

      this.group.add(pivot);
      this.fallingProps.push({
        group: pivot,
        fx,
        fz,
        vx: fx * Math.min(7.5, speed * 0.34),
        vz: fz * Math.min(7.5, speed * 0.34),
        vy: Math.min(2.6, speed * 0.15),
        tiltAngle: 0.05,
        tiltVel: Math.max(1.8, speed * 0.28),
        restTilt,
        settled: false,
        groundBurstDone: false,
        burstKind: 'lamp',
        poleHeight: h,
      });

      this._spawnSparkStreaks(x, 0.9, z, fx, fz, speed, 14);
      this.spawnDebrisBurst(x, h * 0.88, z, fx, fz, speed * 0.75, {
        count: 10,
        matA: this.mats.glassShard,
        matB: poleMat,
        geom: this.geoms.shard,
        scaleMin: 0.18,
        scaleMax: 0.42,
        persistent: true,
      });
      return;
    }

    if (kind === 'hydrant') {
      const hydGroup = new THREE.Group();
      const body = new THREE.Mesh(this.geoms.cyl, this.mats.hydrantRed);
      body.scale.set(0.28, 0.76, 0.28);
      hydGroup.add(body);
      const nozzle = new THREE.Mesh(this.geoms.cyl, this.mats.poleMetal);
      nozzle.scale.set(0.14, 0.44, 0.14);
      nozzle.rotation.z = Math.PI * 0.5;
      nozzle.position.y = 0.12;
      hydGroup.add(nozzle);
      const cap = new THREE.Mesh(this.geoms.cone, this.mats.hydrantRed);
      cap.scale.set(0.28, 0.22, 0.28);
      cap.position.y = 0.44;
      hydGroup.add(cap);

      if (isRestoring) {
        hydGroup.position.set(x + fx * 2.4, 0.18, z + fz * 2.4);
        hydGroup.rotation.set(1.4, 0.6, 1.1);
        this.group.add(hydGroup);
        return;
      }

      hydGroup.position.set(x, 0.45, z);
      this.group.add(hydGroup);
      this.debrisList.push({
        mesh: hydGroup,
        vx: fx * Math.max(6.5, speed * 0.82) + (Math.random() - 0.5) * 2,
        vy: Math.max(4.2, speed * 0.38),
        vz: fz * Math.max(6.5, speed * 0.82) + (Math.random() - 0.5) * 2,
        rx: (Math.random() - 0.5) * 9,
        ry: (Math.random() - 0.5) * 9,
        rz: (Math.random() - 0.5) * 9,
        gravity: 16,
        restY: 0.16,
        persistent: true,
        settled: false,
        age: 0,
        maxAge: Infinity,
      });

      this.geysers.push({
        x,
        z,
        age: 0,
        maxAge: 24,
        emitAccum: 0,
        mistAccum: 0,
      });

      this._spawnSparkStreaks(x, 0.3, z, fx, fz, speed, 10);
      this._spawnVolumetricPlume(x, 0.9, z, 'dust', 0.9, 2.2);
      return;
    }

    if (kind === 'mailbox') {
      const boxGroup = new THREE.Group();
      const body = new THREE.Mesh(this.geoms.box, this.mats.mailboxBlue);
      body.scale.set(0.5, 0.88, 0.5);
      boxGroup.add(body);
      const hood = new THREE.Mesh(this.geoms.cyl, this.mats.mailboxBlue);
      hood.scale.set(0.5, 0.5, 0.5);
      hood.rotation.z = Math.PI * 0.5;
      hood.position.y = 0.44;
      boxGroup.add(hood);

      if (isRestoring) {
        boxGroup.position.set(x + fx * 2.1, 0.25, z + fz * 2.1);
        boxGroup.rotation.set(1.5, 0.4, 0.8);
        this.group.add(boxGroup);
        return;
      }

      boxGroup.position.set(x, 0.58, z);
      this.group.add(boxGroup);
      this.debrisList.push({
        mesh: boxGroup,
        vx: fx * Math.max(5.5, speed * 0.78),
        vy: Math.max(3.6, speed * 0.34),
        vz: fz * Math.max(5.5, speed * 0.78),
        rx: (Math.random() - 0.5) * 7,
        ry: (Math.random() - 0.5) * 7,
        rz: (Math.random() - 0.5) * 7,
        gravity: 16,
        restY: 0.24,
        persistent: true,
        settled: false,
        age: 0,
        maxAge: Infinity,
      });

      this._spawnSparkStreaks(x, 0.35, z, fx, fz, speed, 8);
      return;
    }

    if (kind === 'cart') {
      const umb = new THREE.Mesh(this.geoms.cone, this.mats.umbrellaBlue);
      umb.scale.set(1.85, 0.65, 1.85);
      const cartBody = new THREE.Mesh(this.geoms.box, this.mats.cartSteel);
      cartBody.scale.set(1.1, 0.85, 1.55);

      if (isRestoring) {
        umb.position.set(x + fx * 3.1, 0.28, z + fz * 2.8);
        umb.rotation.set(1.2, 0.5, 0.9);
        cartBody.position.set(x + fx * 1.8, 0.42, z + fz * 1.8);
        cartBody.rotation.set(0.2, 0.8, 1.4);
        this.group.add(umb, cartBody);
        return;
      }

      umb.position.set(x, 2.1, z);
      this.group.add(umb);
      this.debrisList.push({
        mesh: umb,
        vx: fx * Math.max(4.5, speed * 0.55) + (Math.random() - 0.5) * 3,
        vy: Math.max(5.2, speed * 0.45),
        vz: fz * Math.max(4.5, speed * 0.55) + (Math.random() - 0.5) * 3,
        rx: (Math.random() - 0.5) * 5,
        ry: (Math.random() - 0.5) * 5,
        rz: (Math.random() - 0.5) * 5,
        gravity: 8.5,
        restY: 0.25,
        persistent: true,
        settled: false,
        age: 0,
        maxAge: Infinity,
      });

      cartBody.position.set(x, 0.65, z);
      this.group.add(cartBody);
      this.debrisList.push({
        mesh: cartBody,
        vx: fx * Math.max(4.0, speed * 0.62),
        vy: Math.max(2.6, speed * 0.25),
        vz: fz * Math.max(4.0, speed * 0.62),
        rx: (Math.random() - 0.5) * 4,
        ry: (Math.random() - 0.5) * 4,
        rz: (Math.random() - 0.5) * 4,
        gravity: 16.5,
        restY: 0.42,
        persistent: true,
        settled: false,
        age: 0,
        maxAge: Infinity,
      });

      this._spawnSparkStreaks(x, 0.7, z, fx, fz, speed, 12);
      this.spawnDebrisBurst(x, 1.1, z, fx, fz, speed, {
        count: 10,
        matA: this.mats.glassShard,
        matB: this.mats.cartSteel,
        geom: this.geoms.shard,
        scaleMin: 0.22,
        scaleMax: 0.48,
        persistent: true,
      });
      for (let i = 0; i < 5; i++) {
        this._spawnVolumetricPlume(
          x + (Math.random() - 0.5) * 0.8,
          1.0 + i * 0.25,
          z + (Math.random() - 0.5) * 0.8,
          'dust',
          0.85,
          2.4
        );
      }
      return;
    }

    if (kind === 'steam') {
      const stack = new THREE.Mesh(this.geoms.taperedTrunk, this.mats.orangeStripe);
      stack.scale.set(0.42, 1.85, 0.42);
      if (isRestoring) {
        stack.position.set(x + fx * 2.2, 0.22, z + fz * 2.2);
        stack.rotation.set(1.48, 0.3, 0.7);
        this.group.add(stack);
        return;
      }

      stack.position.set(x, 0.95, z);
      this.group.add(stack);
      this.debrisList.push({
        mesh: stack,
        vx: fx * Math.max(5.0, speed * 0.7),
        vy: Math.max(3.5, speed * 0.32),
        vz: fz * Math.max(5.0, speed * 0.7),
        rx: (Math.random() - 0.5) * 7,
        ry: (Math.random() - 0.5) * 7,
        rz: (Math.random() - 0.5) * 7,
        gravity: 15.5,
        restY: 0.22,
        persistent: true,
        settled: false,
        age: 0,
        maxAge: Infinity,
      });

      for (let i = 0; i < 8; i++) {
        this._spawnVolumetricPlume(
          x + (Math.random() - 0.5) * 0.9,
          0.5 + i * 0.32,
          z + (Math.random() - 0.5) * 0.9,
          'dust',
          0.95 + i * 0.15,
          2.6
        );
      }
    }
  }

  /**
   * Builds a multi-part architectural brick-and-mortar wall slab with stepped brick courses and protruding rebar.
   */
  _createBrickWallSlab(scale = 1.0) {
    const g = new THREE.Group();
    const mortarCore = new THREE.Mesh(this.geoms.box, this.mats.mortar);
    mortarCore.scale.set(0.68 * scale, 0.46 * scale, 0.22 * scale);
    g.add(mortarCore);

    const courses = [
      [-0.12, 0.14, 0.44, 0.15, 0.24],
      [0.14, 0.0, 0.48, 0.15, 0.24],
      [-0.08, -0.14, 0.52, 0.15, 0.24],
    ];
    for (let i = 0; i < courses.length; i++) {
      const [ox, oy, sx, sy, sz] = courses[i];
      const brickCourse = new THREE.Mesh(
        this.geoms.box,
        i % 2 === 0 ? this.mats.brick : this.mats.brickDark
      );
      brickCourse.scale.set(sx * scale, sy * scale, sz * scale);
      brickCourse.position.set(ox * scale, oy * scale, 0.01 * scale);
      g.add(brickCourse);
    }

    const rebar = new THREE.Mesh(this.geoms.rebar, this.mats.rustedRebar);
    rebar.scale.set(scale, 0.65 * scale, scale);
    rebar.rotation.z = 0.35;
    rebar.position.set(0.24 * scale, 0.18 * scale, 0);
    g.add(rebar);
    return g;
  }

  /**
   * Builds a structural steel H/I-beam girder section torn from a building frame.
   */
  _createSteelIBeam(scale = 1.0) {
    const g = new THREE.Group();
    const len = 1.35 * scale;
    const web = new THREE.Mesh(this.geoms.box, this.mats.steelGirder);
    web.scale.set(0.04 * scale, 0.22 * scale, len);
    g.add(web);

    for (const s of [-1, 1]) {
      const flange = new THREE.Mesh(this.geoms.box, this.mats.steelGirder);
      flange.scale.set(0.18 * scale, 0.035 * scale, len);
      flange.position.y = s * 0.1 * scale;
      g.add(flange);
    }
    return g;
  }

  /**
   * Builds a shattered architectural window casement frame with jagged remaining safety glass.
   */
  _createWindowCasementPiece(scale = 1.0) {
    const g = new THREE.Group();
    const w = 0.78 * scale;
    const h = 0.96 * scale;
    const topBar = new THREE.Mesh(this.geoms.box, this.mats.pedPostMetal);
    topBar.scale.set(w, 0.06 * scale, 0.06 * scale);
    topBar.position.y = h * 0.5;
    g.add(topBar);

    const botSill = new THREE.Mesh(this.geoms.box, this.mats.limestone);
    botSill.scale.set(w * 1.12, 0.09 * scale, 0.12 * scale);
    botSill.position.y = -h * 0.5;
    g.add(botSill);

    for (const side of [-1, 1]) {
      const jamb = new THREE.Mesh(this.geoms.box, this.mats.pedPostMetal);
      jamb.scale.set(0.055 * scale, h, 0.055 * scale);
      jamb.position.x = side * w * 0.48;
      g.add(jamb);
    }

    const glassCorner = new THREE.Mesh(this.geoms.shard, this.mats.glassShard);
    glassCorner.scale.set(1.1 * scale, 1.0, 1.3 * scale);
    glassCorner.rotation.x = Math.PI * 0.5;
    glassCorner.rotation.z = 0.35;
    glassCorner.position.set(-w * 0.18, h * 0.16, 0);
    g.add(glassCorner);
    return g;
  }

  /**
   * Builds a multi-layer fractured asphalt & concrete sub-base road slab with lane paint remnants.
   */
  _createAsphaltRoadSlab(scale = 1.0, hasStripe = false) {
    const g = new THREE.Group();
    const subbase = new THREE.Mesh(this.geoms.box, this.mats.asphaltSubbase);
    subbase.scale.set(0.68 * scale, 0.11 * scale, 0.56 * scale);
    subbase.position.y = -0.02 * scale;
    g.add(subbase);

    const topLayer = new THREE.Mesh(this.geoms.box, this.mats.asphaltTop);
    topLayer.scale.set(0.64 * scale, 0.06 * scale, 0.52 * scale);
    topLayer.position.y = 0.05 * scale;
    topLayer.rotation.y = 0.18;
    g.add(topLayer);

    if (hasStripe) {
      const stripe = new THREE.Mesh(this.geoms.box, this.mats.roadPaintYellow);
      stripe.scale.set(0.12 * scale, 0.015 * scale, 0.46 * scale);
      stripe.position.set(0.08 * scale, 0.082 * scale, 0);
      g.add(stripe);
    }
    return g;
  }

  /**
   * Fractures and craters the asphalt road or concrete sidewalk at `(x, z)` when struck with high force.
   */
  damageRoadSurface(x, z, rawImpact, isPlayer = false, isRestoring = false) {
    const impact = Math.max(4.5, rawImpact);
    // Avoid stacking duplicate craters on top of the exact same spot
    for (const c of this.roadCraters) {
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz < 3.6) return;
    }

    const radius = Math.min(2.6, Math.max(0.95, 0.65 + impact * 0.085));
    const craterGroup = new THREE.Group();
    craterGroup.position.set(x, 0.015, z);

    // 1. Dark exposed roadbed sub-base pit
    const pit = new THREE.Mesh(this.geoms.circle, this.mats.breachCavity);
    pit.rotation.x = -Math.PI * 0.5;
    pit.scale.set(radius * 0.88, radius * 0.78, 1);
    pit.position.y = 0.008;
    craterGroup.add(pit);

    const outerCrack = new THREE.Mesh(this.geoms.plane, this.mats.crackDecal);
    outerCrack.rotation.x = -Math.PI * 0.5;
    outerCrack.rotation.z = (x * 1.7 + z * 2.3) % (Math.PI * 2);
    outerCrack.scale.set(radius * 2.35, radius * 2.15, 1);
    outerCrack.position.y = 0.005;
    craterGroup.add(outerCrack);

    // 2. Ring of buckled, tilted 3D asphalt & sub-base road slabs around the crater rim
    const slabCount = 7;
    for (let i = 0; i < slabCount; i++) {
      const ang = (i / slabCount) * Math.PI * 2 + ((i % 2) * 0.18);
      const dist = radius * (0.68 + (i % 3) * 0.12);
      const slab = this._createAsphaltRoadSlab(0.58 + (i % 3) * 0.18, i === 0 || i === 3);
      slab.position.set(Math.cos(ang) * dist, 0.055, Math.sin(ang) * dist);
      slab.rotation.y = -ang + Math.PI * 0.5;
      slab.rotation.x = 0.22 + (i % 2) * 0.12;
      slab.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.14;
      craterGroup.add(slab);
    }

    // 3. Exposed bent steel roadbed rebar rods inside the crater
    for (let r = 0; r < 3; r++) {
      const rebar = new THREE.Mesh(this.geoms.rebar, this.mats.rustedRebar);
      rebar.scale.set(1, radius * 1.15, 1);
      rebar.rotation.z = Math.PI * 0.44 + (r - 1) * 0.15;
      rebar.rotation.y = r * 1.05;
      rebar.position.set((r - 1) * 0.22, 0.08, (1 - r) * 0.15);
      craterGroup.add(rebar);
    }

    this.group.add(craterGroup);
    this.roadCraters.push({ x, z, radius, impact });
    this.brokenObjectsCount++;
    this.stats.propsDestroyed = this.brokenObjectsCount;
    this.stats.roadsBroken = (this.stats.roadsBroken || 0) + 1;

    if (!isRestoring) {
      this.savedState.roadCraters.push({
        x: Math.round(x * 10) / 10,
        z: Math.round(z * 10) / 10,
        impact: Math.round(impact * 10) / 10,
      });
      this._scheduleSave();

      // Launch flying asphalt chunks that tumble and settle permanently on the street
      for (let k = 0; k < 5; k++) {
        const ang = Math.random() * Math.PI * 2;
        const chunk = this._createAsphaltRoadSlab(0.42 + Math.random() * 0.28, k === 0);
        chunk.position.set(x + Math.cos(ang) * 0.4, 0.18, z + Math.sin(ang) * 0.4);
        this.group.add(chunk);
        const spd = 2.5 + Math.random() * Math.min(7.5, impact * 0.45);
        this.debrisList.push({
          mesh: chunk,
          vx: Math.cos(ang) * spd,
          vy: 2.2 + Math.random() * 3.4,
          vz: Math.sin(ang) * spd,
          rx: (Math.random() - 0.5) * 9,
          ry: (Math.random() - 0.5) * 9,
          rz: (Math.random() - 0.5) * 9,
          gravity: 16.5,
          restY: 0.06,
          persistent: true,
          settled: false,
          age: 0,
          maxAge: Infinity,
        });
      }
      this._spawnVolumetricPlume(x, 0.45, z, 'dust', 0.95, 2.2);
    }
  }

  /**
   * Applies a realistic suspension bump/jolt when driving over a broken road crater.
   */
  applyCraterSuspensionJolt(entity, mode, dt) {
    if (!entity || !entity.position || (mode !== 'car' && mode !== 'cyclist')) return;
    const speed = Math.abs(entity.speed || 0);
    if (speed < 1.2 || this.roadCraters.length === 0) return;

    const ex = entity.position.x;
    const ez = entity.position.z;
    for (let i = 0; i < this.roadCraters.length; i++) {
      const c = this.roadCraters[i];
      const dx = ex - c.x;
      const dz = ez - c.z;
      const r = c.radius + 0.65;
      if (dx * dx + dz * dz < r * r) {
        const now = performance.now();
        if (now - (entity._lastCraterJoltMs || 0) > 180) {
          entity._lastCraterJoltMs = now;
          const jolt = Math.min(1.2, speed * 0.08);
          if (mode === 'car') {
            entity.heaveVel = (entity.heaveVel || 0) + (Math.random() > 0.4 ? 0.55 : -0.45) * jolt;
            entity.pitchVel = (entity.pitchVel || 0) + (Math.random() - 0.5) * 1.4 * jolt;
            entity.rollVel = (entity.rollVel || 0) + (Math.random() - 0.5) * 1.8 * jolt;
          } else if (mode === 'cyclist') {
            entity.leanAngle = (entity.leanAngle || 0) + (Math.random() - 0.5) * 0.16 * jolt;
          }
        }
        break;
      }
    }
  }

  _spawnFlutteringLeaves(x, y, z, fx, fz, count, leafMat) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geoms.leaf, leafMat);
      const s = 0.22 + Math.random() * 0.26;
      mesh.scale.setScalar(s);
      mesh.position.set(
        x + (Math.random() - 0.5) * 2.2,
        y + (Math.random() - 0.4) * 1.6,
        z + (Math.random() - 0.5) * 2.2
      );
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.group.add(mesh);

      this.debrisList.push({
        mesh,
        vx: fx * (1.2 + Math.random() * 2.5) + (Math.random() - 0.5) * 3.2,
        vy: 0.8 + Math.random() * 2.4,
        vz: fz * (1.2 + Math.random() * 2.5) + (Math.random() - 0.5) * 3.2,
        rx: (Math.random() - 0.5) * 8,
        ry: (Math.random() - 0.5) * 8,
        rz: (Math.random() - 0.5) * 8,
        gravity: 3.6,
        flutter: true,
        restY: 0.03,
        persistent: true,
        settled: false,
        age: 0,
        maxAge: Infinity,
      });
    }
  }

  _spawnSparkStreaks(x, y, z, fx, fz, speed, count = 12) {
    const spread = Math.max(4.0, Math.min(14.0, speed * 0.75));
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geoms.sparkStreak, this.mats.spark);
      const vx = fx * spread * (0.3 + Math.random() * 0.9) + (Math.random() - 0.5) * spread;
      const vy = 2.4 + Math.random() * 5.8;
      const vz = fz * spread * (0.3 + Math.random() * 0.9) + (Math.random() - 0.5) * spread;
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.35,
        Math.max(0.12, y + (Math.random() - 0.3) * 0.35),
        z + (Math.random() - 0.5) * 0.35
      );
      mesh.scale.set(0.8, 0.8, 0.7 + Math.random() * 0.9);
      this.group.add(mesh);

      this.debrisList.push({
        mesh,
        vx,
        vy,
        vz,
        rx: 0,
        ry: 0,
        rz: 0,
        alignVelocity: true,
        gravity: 19.5,
        persistent: false,
        age: 0,
        maxAge: 0.38 + Math.random() * 0.32,
      });
    }
  }

  spawnDebrisBurst(x, y, z, fx, fz, speed, opts = {}) {
    const count = opts.count || 10;
    const matA = opts.matA || this.mats.concrete;
    const matB = opts.matB || this.mats.charcoal;
    const geom = opts.geom || this.geoms.shard;
    const sMin = opts.scaleMin || 0.16;
    const sMax = opts.scaleMax || 0.42;
    const persistent = opts.persistent !== undefined ? opts.persistent : true;

    for (let i = 0; i < count; i++) {
      const mat = i % 2 === 0 ? matA : matB;
      const mesh = new THREE.Mesh(geom, mat);
      const sx = sMin + Math.random() * (sMax - sMin);
      const sy = sMin + Math.random() * (sMax - sMin);
      const sz = sMin + Math.random() * (sMax - sMin);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.65,
        Math.max(0.15, y + (Math.random() - 0.3) * 0.55),
        z + (Math.random() - 0.5) * 0.65
      );
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.group.add(mesh);

      const spread = Math.max(3.2, Math.min(12.5, speed * 0.65));
      this.debrisList.push({
        mesh,
        vx: fx * spread * (0.35 + Math.random() * 0.85) + (Math.random() - 0.5) * spread * 0.9,
        vy: (2.0 + Math.random() * 4.5) * Math.min(2.1, Math.max(0.8, speed * 0.14)),
        vz: fz * spread * (0.35 + Math.random() * 0.85) + (Math.random() - 0.5) * spread * 0.9,
        rx: (Math.random() - 0.5) * 14,
        ry: (Math.random() - 0.5) * 14,
        rz: (Math.random() - 0.5) * 14,
        gravity: 16.5,
        restY: 0.05,
        persistent,
        settled: false,
        age: 0,
        maxAge: persistent ? Infinity : 5.5 + Math.random() * 3.5,
      });
    }
  }

  /**
   * Spawns a soft, camera-facing volumetric billowing smoke or fire plume particle.
   */
  _spawnVolumetricPlume(x, y, z, kind = 'blackSmoke', startScale = 0.75, maxAge = 2.6, initVx = 0, initVz = 0) {
    const mats =
      kind === 'fire'
        ? this.firePlumeMats
        : kind === 'dust'
          ? this.dustSmokeMats
          : this.blackSmokeMats;
    const mesh = new THREE.Mesh(this.geoms.plane, mats[0]);
    mesh.position.set(x, y, z);
    const aspect = kind === 'fire' ? 1.35 + Math.random() * 0.45 : 0.92 + Math.random() * 0.22;
    mesh.scale.set(startScale, startScale * aspect, 1);
    mesh.renderOrder = kind === 'fire' ? 1002 : 1001;
    this.group.add(mesh);

    const isFire = kind === 'fire';
    this.plumes.push({
      mesh,
      mats,
      kind,
      aspect,
      scale: startScale,
      expandRate: isFire ? 0.65 + Math.random() * 0.55 : 1.05 + Math.random() * 0.65,
      vx: initVx + (Math.random() - 0.5) * (isFire ? 1.1 : 1.5),
      vy: isFire ? 2.6 + Math.random() * 2.4 : 1.85 + Math.random() * 1.65,
      vz: initVz + (Math.random() - 0.5) * (isFire ? 1.1 : 1.5),
      roll: Math.random() * Math.PI * 2,
      rollVel: (Math.random() - 0.5) * (isFire ? 3.2 : 1.8),
      turbulencePhase: Math.random() * Math.PI * 2,
      age: 0,
      maxAge: isFire ? 0.55 + Math.random() * 0.45 : maxAge * (0.85 + Math.random() * 0.35),
    });

    if (this.plumes.length > 260) {
      const oldest = this.plumes.shift();
      this.group.remove(oldest.mesh);
    }
  }

  /**
   * Builds a 3D Recessed Wall Breach cavity on a building facade with exposed steel I-beams, broken brick courses,
   * and shattered window casements.
   */
  _spawnBuildingBreachAndRubble(x, y, z, nx, nz, impact, isRestoring = false) {
    const nLen = Math.hypot(nx, nz) || 1;
    const fnx = nx / nLen;
    const fnz = nz / nLen;
    // Tangent along the building wall
    const tx = -fnz;
    const tz = fnx;

    const breachW = Math.min(3.8, Math.max(1.35, 0.95 + impact * 0.14));
    const breachH = Math.min(3.4, Math.max(1.25, 0.85 + impact * 0.12));
    const breachY = Math.max(1.1, y + 0.55);

    const breachGroup = new THREE.Group();
    breachGroup.position.set(x + fnx * 0.04, breachY, z + fnz * 0.04);
    breachGroup.lookAt(x + fnx * 3, breachY, z + fnz * 3);

    // 1. Dark recessed interior room cavity
    const cavity = new THREE.Mesh(this.geoms.plane, this.mats.breachCavity);
    cavity.scale.set(breachW, breachH, 1);
    breachGroup.add(cavity);

    // 2. Outer fracture shadow decal
    const crack = new THREE.Mesh(this.geoms.plane, this.mats.crackDecal);
    crack.scale.set(breachW * 1.55, breachH * 1.45, 1);
    crack.position.z = -0.01;
    breachGroup.add(crack);

    // 3. Exposed structural steel I-beam lintel & twisted vertical rebar inside the breached wall
    const topGirder = this._createSteelIBeam(breachW * 0.65);
    topGirder.rotation.y = Math.PI * 0.5;
    topGirder.rotation.z = -0.08;
    topGirder.position.set(0, breachH * 0.42, 0.08);
    breachGroup.add(topGirder);

    for (let r = -1; r <= 1; r++) {
      const rebar = new THREE.Mesh(this.geoms.rebar, this.mats.rustedRebar);
      rebar.scale.set(1, breachH * 0.82, 1);
      rebar.position.set(r * breachW * 0.28, 0, 0.05);
      rebar.rotation.z = r * 0.16;
      breachGroup.add(rebar);
    }

    // 4. Jagged broken brick/limestone wall blocks framing the breach perimeter
    const edgeCount = 10;
    for (let i = 0; i < edgeCount; i++) {
      const ang = (i / edgeCount) * Math.PI * 2;
      const ex = Math.cos(ang) * breachW * 0.48;
      const ey = Math.sin(ang) * breachH * 0.46;
      const edgeSlab = this._createBrickWallSlab(0.45 + (i % 3) * 0.15);
      edgeSlab.position.set(ex, ey, 0.09);
      edgeSlab.rotation.z = ang + 0.4;
      breachGroup.add(edgeSlab);
    }

    this.group.add(breachGroup);
    this.wallCracks.push(breachGroup);

    if (isRestoring) {
      // Spawn settled permanent rubble pile on the sidewalk/street in front of the breached wall
      for (let k = 0; k < 7; k++) {
        const piece =
          k % 3 === 0
            ? this._createWindowCasementPiece(0.65)
            : k % 3 === 1
              ? this._createSteelIBeam(0.7)
              : this._createBrickWallSlab(0.75);
        const outDist = 0.8 + (k % 4) * 0.65;
        const sideDist = ((k % 5) - 2) * 0.65;
        piece.position.set(
          x + fnx * outDist + tx * sideDist,
          0.14 + (k % 2) * 0.08,
          z + fnz * outDist + tz * sideDist
        );
        piece.rotation.set(1.42, k * 0.9, 0.35);
        this.group.add(piece);
      }
    }
  }

  /**
   * Handles building collisions with equal & opposite structural wall breaching AND progressive multi-stage collapse
   * where the building slowly falls apart above the impact over several seconds.
   */
  onBuildingCollision(entity, mode, x, y, z, nx, nz, speed, isPlayer = false, collider = null) {
    const impact = Math.max(2.5, speed);
    this.brokenObjectsCount++;
    this.stats.propsDestroyed = this.brokenObjectsCount;
    this.stats.buildingsDamaged = (this.stats.buildingsDamaged || 0) + 1;

    if (isPlayer) {
      this.lastImpactLabel =
        impact > 7.5
          ? 'BUILDING WALL BREACHED — PROGRESSIVE COLLAPSE!'
          : 'BUILDING FACADE CRACKED';
      this.lastImpactTimer = 2.8;
    }

    const nLen = Math.hypot(nx, nz) || 1;
    const fnx = nx / nLen;
    const fnz = nz / nLen;
    const tx = -fnz;
    const tz = fnx;

    // 1. Spawn immediate 3D recessed wall breach cavity & record for persistence across restarts
    if (mode !== 'person' || impact > 4.5) {
      this._spawnBuildingBreachAndRubble(x, y, z, fnx, fnz, impact, false);
      this.savedState.buildingBreaches.push({
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        z: Math.round(z * 10) / 10,
        nx: Math.round(fnx * 100) / 100,
        nz: Math.round(fnz * 100) / 100,
        impact: Math.round(impact * 10) / 10,
      });
      this._scheduleSave();

      // Launch composite brick wall slabs, limestone lintels, steel I-beams, and window casements (never raw spheres!)
      const slabCount = Math.min(8, Math.max(3, Math.floor(impact * 0.55)));
      for (let i = 0; i < slabCount; i++) {
        const piece =
          i % 4 === 0
            ? this._createWindowCasementPiece(0.62 + Math.random() * 0.25)
            : i % 4 === 1
              ? this._createSteelIBeam(0.65 + Math.random() * 0.3)
              : this._createBrickWallSlab(0.58 + Math.random() * 0.35);
        const sideOff = (Math.random() - 0.5) * 2.2;
        piece.position.set(
          x + fnx * 0.45 + tx * sideOff,
          Math.max(0.6, y + 0.5 + Math.random() * 1.8),
          z + fnz * 0.45 + tz * sideOff
        );
        piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        this.group.add(piece);

        const launchSpd = Math.max(3.5, Math.min(13.5, impact * 0.72)) * (0.45 + Math.random() * 0.75);
        this.debrisList.push({
          mesh: piece,
          vx: fnx * launchSpd + tx * (Math.random() - 0.5) * 4.5,
          vy: 2.2 + Math.random() * 4.8,
          vz: fnz * launchSpd + tz * (Math.random() - 0.5) * 4.5,
          rx: (Math.random() - 0.5) * 8,
          ry: (Math.random() - 0.5) * 8,
          rz: (Math.random() - 0.5) * 8,
          gravity: 16.5,
          restY: 0.14,
          persistent: true,
          settled: false,
          age: 0,
          maxAge: Infinity,
        });
      }

      // Shattered window glass panes
      this.spawnDebrisBurst(x + fnx * 0.3, Math.max(0.9, y + 1.2), z + fnz * 0.3, fnx, fnz, impact * 0.9, {
        count: Math.min(12, Math.max(5, Math.floor(impact * 0.8))),
        matA: this.mats.glassShard,
        matB: this.mats.limestone,
        geom: this.geoms.shard,
        scaleMin: 0.22,
        scaleMax: 0.52,
        persistent: true,
      });

      this._spawnSparkStreaks(x + fnx * 0.25, Math.max(0.5, y + 0.4), z + fnz * 0.25, fnx, fnz, impact, 14);

      // 2. Start Progressive Structural Building Collapse ("slowly fall apart, breaking walls and things like that")
      const stagesTotal = Math.min(8, Math.max(3, Math.floor(2 + impact * 0.42)));
      this.collapsingBuildings.push({
        x,
        y: Math.max(0.5, y),
        z,
        nx: fnx,
        nz: fnz,
        tx,
        tz,
        impact,
        stage: 0,
        maxStages: stagesTotal,
        timer: 0,
        nextStageDelay: 0.75,
      });
    }

    // Rising volumetric concrete dust & smoke plumes
    const dustCount = mode === 'person' ? 2 : Math.min(7, Math.max(3, Math.floor(impact * 0.45)));
    for (let i = 0; i < dustCount; i++) {
      this._spawnVolumetricPlume(
        x + fnx * 0.35 + (Math.random() - 0.5) * 0.9,
        Math.max(0.5, y + 0.4 + i * 0.25),
        z + fnz * 0.35 + (Math.random() - 0.5) * 0.9,
        impact > 13 && i < 2 ? 'blackSmoke' : 'dust',
        0.85 + Math.random() * 0.45,
        2.4
      );
    }

    // Equal & opposite structural damage applied to the colliding vehicle/aircraft
    this.applyEntityDamage(
      entity,
      mode,
      impact * 1.05,
      x,
      Math.max(0.5, y + 0.5),
      z,
      fnx,
      fnz,
      isPlayer,
      false
    );
  }

  onVehicleCollision(entityA, modeA, entityB, modeB, x, y, z, nx, nz, speed, isPlayerInvolved = false) {
    const impact = Math.max(3.0, speed);
    if (isPlayerInvolved) {
      this.lastImpactLabel = 'VEHICLE CRASH — MUTUAL STRUCTURAL DAMAGE';
      this.lastImpactTimer = 2.5;
    }

    this._spawnSparkStreaks(x, Math.max(0.5, y + 0.5), z, nx, nz, impact, Math.min(22, Math.floor(impact * 1.5)));
    this.spawnDebrisBurst(x, Math.max(0.6, y + 0.6), z, nx, nz, impact, {
      count: Math.min(12, Math.max(4, Math.floor(impact * 0.8))),
      matA: this.mats.glassShard,
      matB: this.mats.charcoal,
      geom: this.geoms.shard,
      scaleMin: 0.16,
      scaleMax: 0.38,
      persistent: true,
    });

    if (impact > 7.0) {
      for (let i = 0; i < 3; i++) {
        this._spawnVolumetricPlume(
          x + (Math.random() - 0.5) * 0.6,
          0.7 + i * 0.2,
          z + (Math.random() - 0.5) * 0.6,
          'blackSmoke',
          0.75 + Math.random() * 0.35,
          2.4
        );
      }
      if (impact > 11.5) {
        for (let i = 0; i < 3; i++) {
          this._spawnVolumetricPlume(
            x + (Math.random() - 0.5) * 0.45,
            0.65,
            z + (Math.random() - 0.5) * 0.45,
            'fire',
            0.7 + Math.random() * 0.35,
            0.65
          );
        }
      }
    }

    // Equal & opposite damage to both vehicles involved in the collision
    if (entityA) {
      this.applyEntityDamage(entityA, modeA, impact * 0.95, x, y + 0.6, z, nx, nz, entityA.isPlayer, false);
    }
    if (entityB) {
      this.applyEntityDamage(entityB, modeB, impact * 0.95, x, y + 0.6, z, -nx, -nz, entityB.isPlayer, false);
    }
  }

  onPedestrianCollision(striker, strikerMode, ped, x, y, z, nx, nz, speed, isPlayer = false, isLethal = false) {
    this.pedestriansStruckCount++;
    this.stats.pedestriansStruck = this.pedestriansStruckCount;

    if (isLethal) {
      this.stats.pedestriansKilled = (this.stats.pedestriansKilled || 0) + 1;
      if (ped && ped._countedHurt) {
        this.stats.pedestriansHurt = Math.max(0, (this.stats.pedestriansHurt || 1) - 1);
      }
    } else if (ped && !ped.isDead && !ped._countedHurt) {
      ped._countedHurt = true;
      this.stats.pedestriansHurt = (this.stats.pedestriansHurt || 0) + 1;
    }

    this._scheduleSave();

    const impact = Math.max(3.5, speed);
    if (isPlayer) {
      this.lastImpactLabel = isLethal
        ? `PEDESTRIAN KILLED (KILLS: ${this.stats.pedestriansKilled})`
        : `PEDESTRIAN HURT (HURT: ${this.stats.pedestriansHurt})`;
      this.lastImpactTimer = 2.6;
    }

    if (striker) {
      this.applyEntityDamage(
        striker,
        strikerMode,
        impact * 0.55,
        x,
        0.92,
        z,
        -nx,
        -nz,
        isPlayer,
        true
      );
    }
  }

  /**
   * Attaches a 3D physical crumpled hood, hanging bumper, and cracked windshield overlay to a damaged AI traffic car/bus.
   */
  _attachTrafficDamageOverlay(v) {
    if (!v || v._damageOverlay) return;
    const overlay = new THREE.Group();
    const isBus = Boolean(v.bus);
    const w = isBus ? 2.2 : 1.52;
    const zFront = isBus ? 5.6 : 2.05;

    const paintMat =
      v.paint && v.paint.length === 3
        ? new THREE.MeshStandardNodeMaterial({
            color: new THREE.Color(v.paint[0], v.paint[1], v.paint[2]).multiplyScalar(0.72),
            roughness: 0.48,
            metalness: 0.35,
          })
        : this.mats.charcoal;

    // 1. Popped, buckled front hood / fascia panel
    if (!isBus) {
      const hood = new THREE.Mesh(this.geoms.box, paintMat);
      hood.scale.set(w * 0.88, 0.06, 1.05);
      hood.position.set(0, 0.88, zFront - 0.62);
      hood.rotation.x = -0.26;
      hood.rotation.z = (Math.random() - 0.5) * 0.18;
      overlay.add(hood);
    }

    // 2. Crooked, half-detached front bumper bar
    const bumper = new THREE.Mesh(this.geoms.bumper, this.mats.charcoal);
    bumper.scale.set(w / 1.48, 1.05, 1.05);
    bumper.position.set(0, 0.36, zFront + 0.04);
    bumper.rotation.z = (Math.random() > 0.5 ? 1 : -1) * 0.14;
    bumper.rotation.y = (Math.random() - 0.5) * 0.12;
    overlay.add(bumper);

    // 3. Spiderwebbed shattered windshield overlay pane
    const glassCrack = new THREE.Mesh(this.geoms.shard, this.mats.glassShard);
    glassCrack.scale.set(w * 2.4, 1.0, 2.2);
    glassCrack.position.set(0, isBus ? 1.65 : 1.16, isBus ? zFront - 0.12 : 0.62);
    glassCrack.rotation.x = isBus ? -0.15 : -0.82;
    overlay.add(glassCrack);

    this.group.add(overlay);
    v._damageOverlay = overlay;
    this.damagedTrafficOverlays.set(v, overlay);
  }

  /**
   * Deforms the actual 3D BufferGeometry vertices of the Player Car or Helicopter/Plane around the world impact point.
   */
  _deformMeshVertices(entity, mesh, worldX, worldY, worldZ, severity, maxRadius = 1.45) {
    if (!mesh || !mesh.geometry || !entity._origPositions) return;
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;

    const ex = entity.position ? entity.position.x : 0;
    const ey = entity.position ? entity.position.y : 0;
    const ez = entity.position ? entity.position.z : 0;
    const heading = entity.heading || 0;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);

    const dx = worldX - ex;
    const dy = worldY - ey;
    const dz = worldZ - ez;
    const localX = dx * cosH - dz * sinH;
    const localY = Math.max(0.35, Math.min(1.65, dy));
    const localZ = dx * sinH + dz * cosH;

    const arr = posAttr.array;
    const orig = entity._origPositions;
    const rSq = maxRadius * maxRadius;
    const dentStrength = Math.min(0.32, 0.042 + severity * 0.016);
    let modified = false;

    for (let i = 0; i < arr.length; i += 3) {
      const ox = orig[i];
      const oy = orig[i + 1];
      const oz = orig[i + 2];

      if (oy < 0.22) continue;

      const vx = arr[i];
      const vy = arr[i + 1];
      const vz = arr[i + 2];

      const ddx = vx - localX;
      const ddy = (vy - localY) * 1.15;
      const ddz = vz - localZ;
      const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
      if (distSq >= rSq) continue;

      const falloff = Math.pow(1 - Math.sqrt(distSq) / maxRadius, 1.55);
      const crease = 0.65 + 0.35 * Math.sin(ox * 9.0 + oz * 7.0);
      const push = dentStrength * falloff * crease;

      const targetX = vx - Math.sign(vx || localX || 1) * push * 0.68;
      const targetZ = vz - Math.sign(vz || localZ || 1) * push * 0.88;
      const buckleY = vy + (Math.sin(ox * 13.0 + oz * 11.0) > 0 ? 1 : -0.5) * push * 0.45;

      arr[i] = Math.max(ox - 0.36, Math.min(ox + 0.36, targetX));
      arr[i + 1] = Math.max(0.22, Math.max(oy - 0.26, Math.min(oy + 0.32, buckleY)));
      arr[i + 2] = Math.max(oz - 0.46, Math.min(oz + 0.46, targetZ));
      modified = true;
    }

    if (modified) {
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
    }
  }

  applyEntityDamage(entity, mode, rawSeverity, x, y, z, nx, nz, isPlayer = false, isSoftTarget = false) {
    if (!entity) return;
    const severity = Math.max(1.5, rawSeverity);
    entity.damage = (entity.damage || 0) + severity * (isSoftTarget ? 0.95 : 1.75);
    entity.integrity = Math.max(0, 100 - entity.damage);
    const dmgRatio = Math.min(1.0, (entity.damage || 0) / 100);

    // 1. CAR & AI TRAFFIC VEHICLE STRUCTURAL DAMAGE
    if (mode === 'car' || mode === 'traffic') {
      entity.dentRoll = (entity.dentRoll || 0) + (Math.random() - 0.5) * 0.065 * Math.min(1.6, severity * 0.15);
      entity.dentPitch = (entity.dentPitch || 0) + (Math.random() - 0.5) * 0.05 * Math.min(1.6, severity * 0.15);
      entity.dentRoll = Math.max(-0.22, Math.min(0.22, entity.dentRoll));
      entity.dentPitch = Math.max(-0.16, Math.min(0.16, entity.dentPitch));

      // For AI traffic vehicles: bend wheel camber/wobble and attach 3D physical damage overlay
      if (mode === 'traffic') {
        entity.wheelCamber = Math.max(
          -0.36,
          Math.min(0.36, (entity.wheelCamber || 0) + (Math.random() > 0.5 ? 1 : -1) * 0.09 * Math.min(2.2, severity * 0.18))
        );
        entity.wheelWobble = Math.min(0.18, (entity.wheelWobble || 0) + 0.03 * dmgRatio);
        if (entity.damage >= 14) {
          this._attachTrafficDamageOverlay(entity);
          if (entity._damageOverlay) {
            entity._damageOverlay.visible = true;
          }
        }
        // Detach a flying bumper or rolling spare wheel on hard traffic crashes
        if (!isSoftTarget && severity > 8.5 && !entity._detachedBumper) {
          entity._detachedBumper = true;
          const bumpMesh = new THREE.Mesh(this.geoms.bumper, this.mats.charcoal);
          bumpMesh.position.set(x, 0.38, z);
          this.group.add(bumpMesh);
          this.debrisList.push({
            mesh: bumpMesh,
            vx: nx * Math.max(4.5, severity * 0.55) + (Math.random() - 0.5) * 3,
            vy: 2.6 + Math.random() * 2.4,
            vz: nz * Math.max(4.5, severity * 0.55) + (Math.random() - 0.5) * 3,
            rx: (Math.random() - 0.5) * 8,
            ry: (Math.random() - 0.5) * 8,
            rz: (Math.random() - 0.5) * 8,
            gravity: 16.0,
            restY: 0.11,
            persistent: true,
            settled: false,
            age: 0,
            maxAge: Infinity,
          });
        }
      }

      // Real 3D vertex crumpling on the player's sculpted taxi body
      if (entity.carBodyMesh && entity._origPositions) {
        this._deformMeshVertices(entity, entity.carBodyMesh, x, y, z, severity, isSoftTarget ? 1.15 : 1.6);
      }

      const ex = entity.position ? entity.position.x : entity.x || 0;
      const ez = entity.position ? entity.position.z : entity.z || 0;
      const heading = entity.heading ?? ((entity.yaw || 0) + (entity.yawOffset || 0));
      const sinH = Math.sin(heading);
      const cosH = Math.cos(heading);
      const dx = x - ex;
      const dz = z - ez;
      const localX = dx * cosH - dz * sinH;
      const localZ = dx * sinH + dz * cosH;

      // Wheel camber, toe misalignment & wobble on the player wheel nearest the impact
      if (entity.wheels && entity.wheels.length) {
        let bestW = entity.wheels[0];
        let bestDist = Infinity;
        for (const w of entity.wheels) {
          const wd = Math.hypot((w.side || 0) * 0.85 - localX, (w.z || 0) - localZ);
          if (wd < bestDist) {
            bestDist = wd;
            bestW = w;
          }
        }
        if (bestW) {
          bestW.camber = Math.max(-0.38, Math.min(0.38, (bestW.camber || 0) + (bestW.side || 1) * 0.075 * Math.min(2, severity * 0.18)));
          bestW.toe = Math.max(-0.28, Math.min(0.28, (bestW.toe || 0) + (Math.random() - 0.5) * 0.12 * dmgRatio));
          bestW.wobble = Math.min(0.18, (bestW.wobble || 0) + 0.025 * dmgRatio);

          if (!isSoftTarget && severity > 10 && entity.damage > 45 && !bestW._poppedVisual) {
            bestW._poppedVisual = true;
            const tireMesh = new THREE.Mesh(this.geoms.tire, this.mats.charcoal);
            tireMesh.position.set(x, 0.38, z);
            tireMesh.rotation.y = heading;
            this.group.add(tireMesh);
            this.debrisList.push({
              mesh: tireMesh,
              vx: nx * Math.max(5, severity * 0.65) + (Math.random() - 0.5) * 3,
              vy: 3.2 + Math.random() * 2.5,
              vz: nz * Math.max(5, severity * 0.65) + (Math.random() - 0.5) * 3,
              rx: 12,
              ry: (Math.random() - 0.5) * 4,
              rz: (Math.random() - 0.5) * 4,
              gravity: 15.5,
              restY: 0.14,
              persistent: true,
              settled: false,
              age: 0,
              maxAge: Infinity,
            });
          }
        }
      }

      if (entity.headLights && localZ > 0.8 && severity > 4.5) {
        for (const spot of entity.headLights) {
          if (Math.sign(localX || spot._side) === spot._side || Math.abs(localX) < 0.45) {
            if (severity > 11 || entity.damage > 60) {
              spot._broken = true;
            } else {
              spot._flicker = 1;
            }
          }
        }
      }

      if (!isSoftTarget || severity > 7.5) {
        this.spawnDebrisBurst(x, Math.max(0.55, y), z, nx, nz, severity * 0.8, {
          count: isSoftTarget ? 4 : Math.min(10, Math.max(4, Math.floor(severity * 0.6))),
          matA: this.mats.glassShard,
          matB: mode === 'car' ? this.mats.taxiYellow : this.mats.charcoal,
          geom: this.geoms.shard,
          scaleMin: 0.14,
          scaleMax: 0.34,
          persistent: true,
        });
      }

      if (entity.damage > 18) {
        if (!entity.position && entity.x !== undefined) {
          entity.position = { x: entity.x, y: 0, z: entity.z };
        }
        this.smokeEmitters.set(entity, { entity, mode, accum: 0 });
      }
      return;
    }

    // 2. CYCLIST & BICYCLE FRAME/WHEEL DAMAGE
    if (mode === 'cyclist') {
      entity.dentRoll = Math.max(-0.26, Math.min(0.26, (entity.dentRoll || 0) + (Math.random() - 0.5) * 0.12));
      entity.leanAngle = (entity.leanAngle || 0) + (Math.random() - 0.5) * 0.35;
      entity.wheelBuckle = Math.min(0.32, (entity.wheelBuckle || 0) + 0.045 * Math.min(2.2, severity * 0.22));
      if (entity.damage > 35) {
        entity.rearBuckle = Math.min(0.24, (entity.rearBuckle || 0) + 0.03 * dmgRatio);
      }
      if (entity.frontWheel) {
        entity.frontWheel.rotation.y = Math.max(-0.42, Math.min(0.42, (entity.frontWheel.rotation.y || 0) + (Math.random() - 0.5) * 0.18));
      }
      if (entity.handlebar) {
        entity.handlebar.rotation.y = Math.max(-0.48, Math.min(0.48, (entity.handlebar.rotation.y || 0) + (Math.random() - 0.5) * 0.22));
      }
      if (entity.fork) {
        entity.fork.rotation.z = Math.max(-0.25, Math.min(0.25, (entity.fork.rotation.z || 0) + (Math.random() - 0.5) * 0.12));
      }
      if (entity.saddle) {
        entity.saddle.rotation.z = Math.max(-0.3, Math.min(0.3, (entity.saddle.rotation.z || 0) + (Math.random() - 0.5) * 0.15));
      }
      if (!isSoftTarget && severity > 4) {
        this._spawnSparkStreaks(x, 0.45, z, nx, nz, severity, 8);
      }
      return;
    }

    // 3. PLANE / HELICOPTER STRUCTURAL & AERODYNAMIC DAMAGE
    if (mode === 'helicopter') {
      entity.dentRoll = Math.max(-0.28, Math.min(0.28, (entity.dentRoll || 0) + (Math.random() - 0.5) * 0.12));
      entity.dentPitch = Math.max(-0.20, Math.min(0.20, (entity.dentPitch || 0) + (Math.random() - 0.5) * 0.09));

      if (entity.heliBodyMesh && entity._origPositions) {
        this._deformMeshVertices(entity, entity.heliBodyMesh, x, y, z, severity, 2.1);
      }
      if (entity.planeWings) {
        entity.planeWings.rotation.z = Math.max(-0.28, Math.min(0.28, (entity.planeWings.rotation.z || 0) + (Math.random() - 0.5) * 0.14));
        entity.planeWings.rotation.x = Math.max(-0.18, Math.min(0.18, (entity.planeWings.rotation.x || 0) + (Math.random() - 0.5) * 0.08));
      }
      if (entity.winglets && entity.winglets.length) {
        for (const wl of entity.winglets) {
          wl.rotation.z = (wl.rotation.z || 0) + wl._side * 0.08 * dmgRatio;
        }
      }
      if (entity.tailRotorPivot) {
        entity.tailRotorPivot.rotation.z = Math.max(-0.32, Math.min(0.32, (entity.tailRotorPivot.rotation.z || 0) + (Math.random() - 0.5) * 0.14));
      }
      if (!isSoftTarget) {
        this._spawnSparkStreaks(x, y, z, nx, nz, severity, 12);
        this.spawnDebrisBurst(x, y, z, nx, nz, severity * 0.8, {
          count: 6,
          matA: this.mats.glassShard,
          matB: this.mats.cartSteel,
          geom: this.geoms.shard,
          scaleMin: 0.18,
          scaleMax: 0.42,
          persistent: true,
        });
      }
      if (entity.damage > 18) {
        this.smokeEmitters.set(entity, { entity, mode, accum: 0 });
      }
      return;
    }

    // 4. PERSON (WALK / RUN) IMPACT STUMBLE & BRUISING
    if (mode === 'person') {
      entity.stumbleTimer = Math.max(entity.stumbleTimer || 0, 0.65);
      if (entity.rig) {
        entity.rig.pelvisRoll = (Math.random() - 0.5) * 0.28;
        entity.rig.pelvisTilt = 0.14;
      }
    }
  }

  repairEntity(entity) {
    if (!entity) return;
    entity.damage = 0;
    entity.integrity = 100;
    entity.dentRoll = 0;
    entity.dentPitch = 0;
    entity.wheelBuckle = 0;
    entity.rearBuckle = 0;
    entity.stumbleTimer = 0;

    const meshToRestore = entity.carBodyMesh || entity.heliBodyMesh;
    if (meshToRestore && meshToRestore.geometry && entity._origPositions) {
      const posAttr = meshToRestore.geometry.attributes.position;
      if (posAttr && posAttr.array.length === entity._origPositions.length) {
        posAttr.array.set(entity._origPositions);
        posAttr.needsUpdate = true;
        meshToRestore.geometry.computeVertexNormals();
      }
    }

    if (entity.body) {
      entity.body.scale.set(1, 1, 1);
      entity.body.rotation.set(0, 0, 0);
    }
    if (entity.wheels) {
      for (const w of entity.wheels) {
        w.camber = 0;
        w.toe = 0;
        w.wobble = 0;
        w._poppedVisual = false;
        w.rotation.z = 0;
        w.rotation.y = 0;
      }
    }
    if (entity.headLights) {
      for (const spot of entity.headLights) {
        spot._broken = false;
        spot._flicker = 0;
      }
    }
    if (entity.bike) {
      entity.bike.rotation.z = 0;
    }
    if (entity.frontWheel) {
      entity.frontWheel.rotation.y = 0;
      entity.frontWheel.rotation.z = 0;
    }
    if (entity.rearWheel) {
      entity.rearWheel.rotation.z = 0;
    }
    if (entity.handlebar) {
      entity.handlebar.rotation.y = 0;
    }
    if (entity.fork) {
      entity.fork.rotation.z = 0;
    }
    if (entity.saddle) {
      entity.saddle.rotation.z = 0;
    }
    if (entity.planeWings) {
      entity.planeWings.rotation.set(0, 0, 0);
    }
    if (entity.winglets) {
      for (const wl of entity.winglets) wl.rotation.set(0, 0, 0);
    }
    if (entity.tailRotorPivot) {
      entity.tailRotorPivot.rotation.z = 0;
    }

    this.smokeEmitters.delete(entity);
    this.lastImpactLabel = 'VEHICLE & GEAR REPAIRED (100%)';
    this.lastImpactTimer = 2.0;
  }

  update(dt, camera = null) {
    if (this.lastImpactTimer > 0) {
      this.lastImpactTimer = Math.max(0, this.lastImpactTimer - dt);
    }

    // Periodically flush persistent destruction state to localStorage
    if (this._savePending) {
      this._saveTimer += dt;
      if (this._saveTimer >= 0.4) {
        this._saveTimer = 0;
        this._flushSave();
      }
    }

    // 0. Update swaying/shuddering trees that were lightly struck
    for (let i = this.swayingTrees.length - 1; i >= 0; i--) {
      const st = this.swayingTrees[i];
      if (!st.pivot || st.prop.destroyed) {
        this.swayingTrees.splice(i, 1);
        continue;
      }
      st.phase += dt * 11.5;
      st.amp *= Math.exp(-st.decay * dt);
      const tilt = Math.sin(st.phase) * st.amp;
      st.pivot.rotation.order = 'YXZ';
      st.pivot.rotation.z = -st.fx * tilt;
      st.pivot.rotation.x = st.fz * tilt;
      if (st.amp < 0.002) {
        st.pivot.rotation.set(0, 0, 0);
        this.swayingTrees.splice(i, 1);
      }
    }

    // 1. Update toppling poles, signals & real procedural trees (NEVER auto-removed; settle permanently on the street)
    for (let i = 0; i < this.fallingProps.length; i++) {
      const fp = this.fallingProps[i];
      if (fp.settled) continue;

      fp.group.position.x += fp.vx * dt;
      fp.group.position.z += fp.vz * dt;
      fp.vx *= Math.exp(-3.2 * dt);
      fp.vz *= Math.exp(-3.2 * dt);

      if (fp.group.position.y > 0.14 || fp.vy > 0) {
        fp.group.position.y += fp.vy * dt;
        fp.vy -= 14.0 * dt;
        if (fp.group.position.y < 0.14) {
          fp.group.position.y = 0.14;
          fp.vy = 0;
        }
      }

      const maxTilt = fp.restTilt || Math.PI * 0.475;
      const inertia = fp.burstKind === 'tree' ? 5.2 : 7.5;
      fp.tiltVel += Math.sin(Math.max(0.08, fp.tiltAngle)) * inertia * dt;
      fp.tiltAngle += fp.tiltVel * dt;

      if (fp.tiltAngle >= maxTilt) {
        fp.tiltAngle = maxTilt;
        if (!fp.groundBurstDone) {
          fp.groundBurstDone = true;
          const tipDist = fp.poleHeight || 4.2;
          const tipX = fp.group.position.x + fp.fx * tipDist;
          const tipZ = fp.group.position.z + fp.fz * tipDist;
          if (fp.burstKind === 'tree') {
            this._spawnFlutteringLeaves(tipX, 0.8, tipZ, fp.fx, fp.fz, 18, fp.leafMat || this.mats.leafGreen);
            this._spawnVolumetricPlume(tipX, 0.55, tipZ, 'dust', 1.05, 2.2);
          } else {
            this._spawnSparkStreaks(tipX, 0.25, tipZ, fp.fx, fp.fz, 7.5, 12);
            this.spawnDebrisBurst(tipX, 0.3, tipZ, fp.fx, fp.fz, 6.0, {
              count: 8,
              matA: this.mats.glassShard,
              matB: this.mats.poleMetal,
              geom: this.geoms.shard,
              scaleMin: 0.14,
              scaleMax: 0.32,
              persistent: true,
            });
          }
          if (this.reportCollision) {
            this.reportCollision(
              fp.burstKind === 'tree' ? 'tree' : 'lamp',
              tipX,
              0.3,
              tipZ,
              5.5
            );
          }
        }
        fp.tiltVel = -fp.tiltVel * 0.22;
        if (Math.abs(fp.tiltVel) < 0.22 && Math.hypot(fp.vx, fp.vz) < 0.1) {
          fp.tiltAngle = maxTilt;
          fp.tiltVel = 0;
          fp.vx = fp.vz = 0;
          fp.settled = true;
        }
      }

      fp.group.rotation.order = 'YXZ';
      fp.group.rotation.z = -fp.fx * fp.tiltAngle;
      fp.group.rotation.x = fp.fz * fp.tiltAngle;
    }

    // 2. Update progressive building collapses ("slowly fall apart, breaking walls and things like that")
    for (let i = this.collapsingBuildings.length - 1; i >= 0; i--) {
      const cb = this.collapsingBuildings[i];
      cb.timer += dt;
      if (cb.timer < cb.nextStageDelay) continue;

      cb.timer = 0;
      cb.stage++;
      cb.nextStageDelay = 0.85 + Math.random() * 0.55;

      const stageY = cb.y + 1.8 + cb.stage * 2.35;
      const latOffset = (Math.random() - 0.5) * 2.8;
      const sx = cb.x + cb.tx * latOffset;
      const sz = cb.z + cb.tz * latOffset;

      // Open an upper structural wall breach cavity as the upper wall gives way
      this._spawnBuildingBreachAndRubble(sx, stageY, sz, cb.nx, cb.nz, cb.impact * 0.72, false);

      // Drop cascading wall slabs, window casements & steel beams from the collapsing upper story
      const pieceCount = 3 + (cb.stage % 2);
      for (let p = 0; p < pieceCount; p++) {
        const piece =
          p === 0
            ? this._createBrickWallSlab(0.68 + Math.random() * 0.32)
            : p === 1
              ? this._createWindowCasementPiece(0.65 + Math.random() * 0.25)
              : this._createSteelIBeam(0.7 + Math.random() * 0.28);
        const pOff = (Math.random() - 0.5) * 2.2;
        piece.position.set(
          sx + cb.nx * 0.45 + cb.tx * pOff,
          stageY + (Math.random() - 0.3) * 0.8,
          sz + cb.nz * 0.45 + cb.tz * pOff
        );
        piece.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
        this.group.add(piece);

        const outSpd = 1.8 + Math.random() * 3.8;
        this.debrisList.push({
          mesh: piece,
          vx: cb.nx * outSpd + cb.tx * (Math.random() - 0.5) * 2.4,
          vy: 0.5 + Math.random() * 1.8,
          vz: cb.nz * outSpd + cb.tz * (Math.random() - 0.5) * 2.4,
          rx: (Math.random() - 0.5) * 6,
          ry: (Math.random() - 0.5) * 6,
          rz: (Math.random() - 0.5) * 6,
          gravity: 16.2,
          restY: 0.14 + Math.random() * 0.12,
          persistent: true,
          settled: false,
          age: 0,
          maxAge: Infinity,
        });
      }

      // Billowing masonry dust plume from the collapsing upper wall
      this._spawnVolumetricPlume(sx + cb.nx * 0.5, stageY, sz + cb.nz * 0.5, 'dust', 1.15, 2.6);
      if (this.reportCollision) {
        this.reportCollision('building', sx, stageY * 0.5, sz, 6.2);
      }

      if (cb.stage >= cb.maxStages) {
        this.collapsingBuildings.splice(i, 1);
      }
    }

    // 3. Update 3D flying shards, masonry slabs, asphalt chunks, branches & fluttering leaves
    //    Persistent pieces NEVER auto-delete: once their bounce/slide settles, they remain permanently in the scene!
    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i];
      if (d.settled) continue;

      d.age += dt;
      if (!d.persistent && d.age >= d.maxAge) {
        this.group.remove(d.mesh);
        this.debrisList.splice(i, 1);
        continue;
      }

      if (d.flutter) {
        d.vx += Math.sin(d.age * 7.5 + i) * 2.4 * dt;
        d.vz += Math.cos(d.age * 6.8 + i) * 2.4 * dt;
        d.vx *= Math.exp(-1.8 * dt);
        d.vz *= Math.exp(-1.8 * dt);
      }

      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      d.vy -= d.gravity * dt;

      if (d.alignVelocity) {
        const spdXZ = Math.hypot(d.vx, d.vz) || 0.001;
        d.mesh.rotation.order = 'YXZ';
        d.mesh.rotation.y = Math.atan2(d.vx, d.vz);
        d.mesh.rotation.x = -Math.atan2(d.vy, spdXZ);
      } else {
        d.mesh.rotation.x += d.rx * dt;
        d.mesh.rotation.y += d.ry * dt;
        d.mesh.rotation.z += d.rz * dt;
      }

      const floorY = d.restY !== undefined ? d.restY : 0.08;
      if (d.mesh.position.y < floorY) {
        d.mesh.position.y = floorY;
        if (d.flutter) {
          d.vy = 0;
          d.vx = 0;
          d.vz = 0;
          d.rx = d.ry = d.rz = 0;
          if (d.persistent) d.settled = true;
        } else {
          d.vy = Math.abs(d.vy) * 0.34;
          d.vx *= 0.68;
          d.vz *= 0.68;
          d.rx *= 0.62;
          d.ry *= 0.62;
          d.rz *= 0.62;
          if (d.persistent && d.vy < 0.45 && Math.hypot(d.vx, d.vz) < 0.22) {
            d.vy = 0;
            d.vx = 0;
            d.vz = 0;
            d.rx = d.ry = d.rz = 0;
            d.settled = true;
          }
        }
      }
    }

    // 4. Sync 3D physical damage overlays on struck AI traffic vehicles
    for (const [v, overlay] of this.damagedTrafficOverlays.entries()) {
      if (!v || !v.edge || (v.damage || 0) <= 0) {
        overlay.visible = false;
        continue;
      }
      overlay.visible = true;
      overlay.position.set(v.x, 0, v.z);
      overlay.rotation.order = 'YXZ';
      overlay.rotation.set(v.pitch || 0, (v.yaw || 0) + (v.yawOffset || 0), v.roll || 0);
    }

    // 5. Update camera-facing volumetric billowing smoke & fire plumes
    const camQuat = camera ? camera.quaternion : null;
    for (let i = this.plumes.length - 1; i >= 0; i--) {
      const p = this.plumes[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.group.remove(p.mesh);
        this.plumes.splice(i, 1);
        continue;
      }

      const lifeRatio = p.age / p.maxAge;
      const stageIdx = Math.min(p.mats.length - 1, Math.floor(lifeRatio * p.mats.length));
      if (p.mesh.material !== p.mats[stageIdx]) {
        p.mesh.material = p.mats[stageIdx];
      }

      const swirl = Math.sin(p.age * 4.2 + p.turbulencePhase) * (p.kind === 'fire' ? 1.4 : 0.95);
      p.mesh.position.x += (p.vx + swirl) * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += (p.vz + Math.cos(p.age * 3.8 + p.turbulencePhase) * 0.85) * dt;

      if (p.kind === 'fire') {
        const flicker = 0.88 + 0.24 * Math.sin(p.age * 28.0 + p.turbulencePhase);
        p.scale += p.expandRate * dt;
        const taper = 1.0 - lifeRatio * 0.35;
        p.mesh.scale.set(p.scale * taper * flicker, p.scale * p.aspect * flicker, 1);
      } else {
        p.vy = Math.max(0.75, p.vy * Math.exp(-0.35 * dt));
        p.scale += p.expandRate * dt;
        p.mesh.scale.set(p.scale, p.scale * p.aspect, 1);
      }

      p.roll += p.rollVel * dt;
      if (camQuat) {
        p.mesh.quaternion.copy(camQuat);
        p.mesh.rotateZ(p.roll);
      } else {
        p.mesh.rotation.z = p.roll;
      }
    }

    // 6. Update active sheared fire-hydrant water geysers
    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const g = this.geysers[i];
      g.age += dt;
      if (g.age >= g.maxAge) {
        this.geysers.splice(i, 1);
        continue;
      }
      g.emitAccum += dt;
      while (g.emitAccum >= 0.04) {
        g.emitAccum -= 0.04;
        const drop = new THREE.Mesh(this.geoms.cyl, this.mats.waterDrop);
        const s = 0.12 + Math.random() * 0.14;
        drop.scale.set(s * 0.65, s * 2.6, s * 0.65);
        drop.position.set(
          g.x + (Math.random() - 0.5) * 0.16,
          0.35,
          g.z + (Math.random() - 0.5) * 0.16
        );
        this.group.add(drop);
        this.debrisList.push({
          mesh: drop,
          vx: (Math.random() - 0.5) * 1.9,
          vy: 9.2 + Math.random() * 3.8,
          vz: (Math.random() - 0.5) * 1.9,
          rx: 0,
          ry: 0,
          rz: 0,
          alignVelocity: true,
          gravity: 15.0,
          persistent: false,
          age: 0,
          maxAge: 1.4,
        });
      }
      g.mistAccum = (g.mistAccum || 0) + dt;
      if (g.mistAccum >= 0.16) {
        g.mistAccum = 0;
        this._spawnVolumetricPlume(
          g.x + (Math.random() - 0.5) * 0.35,
          0.8 + Math.random() * 1.5,
          g.z + (Math.random() - 0.5) * 0.35,
          'dust',
          0.65 + Math.random() * 0.35,
          1.45
        );
      }
    }

    // 7. Update damaged vehicle/aircraft volumetric black engine smoke & fire emitters
    for (const [ent, em] of this.smokeEmitters.entries()) {
      if (!ent || (ent.damage || 0) <= 16) {
        this.smokeEmitters.delete(ent);
        continue;
      }
      const ex = ent.position ? ent.position.x : ent.x;
      const ez = ent.position ? ent.position.z : ent.z;
      const ey = ent.position ? ent.position.y || 0 : 0;
      if (ex === undefined || ez === undefined) continue;

      const dmg = ent.damage || 0;
      em.accum += dt;
      const interval = dmg > 70 ? 0.045 : dmg > 45 ? 0.075 : 0.13;
      if (em.accum >= interval) {
        em.accum = 0;
        const heading = ent.heading ?? ((ent.yaw || 0) + (ent.yawOffset || 0));
        const sinH = Math.sin(heading);
        const cosH = Math.cos(heading);

        const fwdOffset = em.mode === 'helicopter' ? -0.65 : 1.52;
        const baseH = em.mode === 'helicopter' ? 2.05 : 0.72;
        const srcX = ex + sinH * fwdOffset + (Math.random() - 0.5) * 0.42;
        const srcY = ey + baseH;
        const srcZ = ez + cosH * fwdOffset + (Math.random() - 0.5) * 0.42;

        const smokeStartScale = 0.55 + Math.min(0.65, (dmg - 16) * 0.008);
        this._spawnVolumetricPlume(
          srcX,
          srcY,
          srcZ,
          'blackSmoke',
          smokeStartScale,
          2.2 + Math.min(1.4, dmg * 0.015)
        );

        if (dmg > 40 && Math.random() < (dmg > 70 ? 0.78 : 0.48)) {
          this._spawnVolumetricPlume(
            srcX + (Math.random() - 0.5) * 0.22,
            srcY - 0.05,
            srcZ + (Math.random() - 0.5) * 0.22,
            'fire',
            0.48 + Math.min(0.52, (dmg - 40) * 0.009),
            0.55
          );
          if (dmg > 65 && Math.random() < 0.32) {
            this._spawnSparkStreaks(srcX, srcY + 0.1, srcZ, sinH, cosH, 5.5, 2);
          }
        }
      }
    }
  }
}
