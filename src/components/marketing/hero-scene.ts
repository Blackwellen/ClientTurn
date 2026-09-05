import * as THREE from "three";

/** Owns every GPU resource and browser subscription for one mounted hero. */
export function createHeroScene(mount: HTMLDivElement) {
  const palette = getComputedStyle(mount);
  const colour = (token: string) => palette.getPropertyValue(token).trim();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  camera.position.set(0, 0, 10.8);
  const group = new THREE.Group();
  group.rotation.set(0.22, -0.25, -0.08);
  scene.add(group);
  const sculpture = new THREE.Group();
  scene.add(sculpture);
  let progress = 0;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.push(value); return value; };
  const material = <T extends THREE.Material>(value: T) => { materials.push(value); return value; };
  let frame = 0;
  let disposed = false;
  let lost = false;
  let visible = false;
  let paused = false;
  let elapsed = 0;
  let previous = 0;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = new THREE.Vector2();
  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });

  function cleanup() {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    motion.removeEventListener("change", sync);
    document.removeEventListener("visibilitychange", sync);
    mount.removeEventListener("pointermove", move);
    mount.removeEventListener("pointerleave", leave);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
    geometries.forEach((item) => item.dispose());
    materials.forEach((item) => item.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    delete mount.dataset.ready;
  }

  function render() {
    const unfold = THREE.MathUtils.smoothstep(progress, 0.35, 0.9);
    sculpture.rotation.set(0.18 + progress * 0.45, -0.45 + progress * Math.PI * 1.4, -0.28 + progress * 0.4);
    sculpture.scale.setScalar(1 - unfold * 0.8);
    sculpture.visible = unfold < 0.98;
    sculpture.position.y = Math.sin(elapsed * 0.6) * 0.07;
    sculpture.children.forEach((layer, index) => {
      layer.position.z = (index - 2) * (0.16 + Math.sin(progress * Math.PI) * 0.28);
    });
    group.visible = progress > 0.48;
    group.scale.setScalar(0.35 + unfold * 0.65);
    group.position.y = -0.15;
    if (!disposed && !lost) renderer.render(scene, camera);
  }
  function resize() {
    const { width, height } = mount.getBoundingClientRect();
    if (!width || !height || disposed) return;
    camera.aspect = width / height;
    camera.position.z = camera.aspect < 0.85 ? 10.5 : 8.6;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  }
  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse" || motion.matches || paused) return;
    const rect = mount.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width - 0.5, (event.clientY - rect.top) / rect.height - 0.5);
  }
  function leave() { pointer.set(0, 0); }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    delete mount.dataset.ready;
    sync();
  }
  function contextRestored() {
    lost = false;
    resize();
    mount.dataset.ready = "true";
    sync();
  }
  function sync() {
    cancelAnimationFrame(frame);
    previous = 0;
    if (disposed || lost || !visible || document.hidden) return;
    if (motion.matches || paused) {
      pointer.set(0, 0);
      group.rotation.set(0.22, -0.25, -0.08);
      render();
    } else frame = requestAnimationFrame(animate);
  }

  // A single curved route and six stations mirror the actual lead workflow.
  const points = [
    new THREE.Vector3(-2.65, -1.1, 0),
    new THREE.Vector3(-1.55, -0.85, 0),
    new THREE.Vector3(-0.45, -0.25, 0),
    new THREE.Vector3(0.1, 0.85, 0),
    new THREE.Vector3(1.3, 1.15, 0),
    new THREE.Vector3(2.55, 1.15, 0),
  ];
  const route = new THREE.CatmullRomCurve3(points);
  const beads: THREE.Mesh[] = [];
  function animate(now: number) {
    if (disposed || lost) return;
    const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
    previous = now;
    elapsed += delta;
    group.rotation.y += (-0.25 + pointer.x * 0.25 - group.rotation.y) * Math.min(1, delta * 5);
    group.rotation.x += (0.22 + pointer.y * 0.15 - group.rotation.x) * Math.min(1, delta * 5);
    beads.forEach((bead, index) => route.getPointAt((elapsed * 0.06 + index / beads.length) % 1, bead.position));
    render();
    frame = requestAnimationFrame(animate);
  }

  try {
    const lime = colour("--ct-lime");
    const soft = colour("--ct-lime-soft");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x182039, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-3, 4, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(soft, 2);
    rim.position.set(3, -2, 2);
    scene.add(rim);

    const trackMaterial = material(new THREE.MeshStandardMaterial({ color: 0x45516b, roughness: 0.65 }));
    group.add(new THREE.Mesh(geometry(new THREE.TubeGeometry(route, 80, 0.075, 8, false)), trackMaterial));
    const tileGeometry = geometry(new THREE.BoxGeometry(0.73, 0.73, 0.22));
    const tileMaterial = material(new THREE.MeshStandardMaterial({ color: 0x253149, roughness: 0.45, metalness: 0.15 }));
    const activeMaterial = material(new THREE.MeshStandardMaterial({ color: lime, roughness: 0.55 }));
    const detailGeometry = geometry(new THREE.BoxGeometry(0.38, 0.045, 0.02));
    const detailMaterial = material(new THREE.MeshBasicMaterial({ color: soft }));
    const darkDetailMaterial = material(new THREE.MeshBasicMaterial({ color: colour("--ct-midnight") }));
    const arc = new THREE.Shape();
    const start = Math.PI * 0.2;
    const end = Math.PI * 1.8;
    arc.absarc(0, 0, 1.75, start, end, false);
    arc.lineTo(Math.cos(end) * 1.02, Math.sin(end) * 1.02);
    arc.absarc(0, 0, 1.02, end, start, true);
    arc.closePath();
    const arcGeometry = geometry(new THREE.ExtrudeGeometry(arc, {
      depth: 0.12, bevelEnabled: true, bevelSegments: 3,
      steps: 1, bevelSize: 0.055, bevelThickness: 0.055, curveSegments: 48,
    }));
    const sculptureLime = material(new THREE.MeshStandardMaterial({ color: lime, roughness: 0.3, metalness: 0.12 }));
    const sculptureDark = material(new THREE.MeshStandardMaterial({ color: 0x364335, roughness: 0.38, metalness: 0.2 }));
    for (let index = 0; index < 5; index++) {
      sculpture.add(new THREE.Mesh(arcGeometry, index === 4 || index === 0 ? sculptureLime : sculptureDark));
    }
    points.forEach((point, index) => {
      const tile = new THREE.Mesh(tileGeometry, index === 5 ? activeMaterial : tileMaterial);
      tile.position.copy(point);
      tile.position.z = 0.1;
      tile.rotation.z = -0.1;
      group.add(tile);
      for (let line = 0; line < 3; line++) {
        const detail = new THREE.Mesh(detailGeometry, index === 5 ? darkDetailMaterial : detailMaterial);
        detail.position.set(0, 0.13 - line * 0.13, 0.13);
        detail.scale.x = line === 2 ? 0.6 : 1;
        tile.add(detail);
      }
    });
    const beadGeometry = geometry(new THREE.SphereGeometry(0.065, 12, 8));
    const beadMaterial = material(new THREE.MeshBasicMaterial({ color: lime }));
    for (let index = 0; index < 5; index++) {
      const bead = new THREE.Mesh(beadGeometry, beadMaterial);
      route.getPointAt(index / 5, bead.position);
      beads.push(bead);
      group.add(bead);
    }
    mount.appendChild(renderer.domElement);
    resize();
    mount.dataset.ready = "true";
    resizeObserver.observe(mount);
    intersectionObserver.observe(mount);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    mount.addEventListener("pointermove", move);
    mount.addEventListener("pointerleave", leave);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    dispose: cleanup,
    setPaused(value: boolean) { paused = value; sync(); },
    setProgress(value: number) { progress = value; if (paused || motion.matches) render(); },
  };
}
