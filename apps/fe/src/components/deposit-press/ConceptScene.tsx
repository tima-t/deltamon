"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { paperLength, interpolatePaper, PRESS_FEED_DURATION } from "./pressProgress";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export default function ConceptScene({
  concept,
  paused,
  stage,
  dark,
  working = false,
  complete = false,
  printRun = 0,
  confirmedSteps = 0,
  sourceName = "Monad",
  amount = "—",
  simulated = true,
  receiptRows,
  reducedMotion = false,
}: {
  concept: "press" | "sculpture";
  paused: boolean;
  stage: number;
  dark: boolean;
  working?: boolean;
  complete?: boolean;
  printRun?: number;
  confirmedSteps?: number;
  sourceName?: string;
  amount?: string;
  simulated?: boolean;
  receiptRows?: readonly (readonly [string, string])[];
  reducedMotion?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({
    paused,
    stage,
    working,
    complete,
    printRun,
    confirmedSteps,
    sourceName,
    amount,
    simulated,
    receiptRows,
    reducedMotion,
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    live.current = {
      paused,
      stage,
      working,
      complete,
      printRun,
      confirmedSteps,
      sourceName,
      amount,
      simulated,
      receiptRows,
      reducedMotion,
    };
  }, [
    paused,
    stage,
    working,
    complete,
    printRun,
    confirmedSteps,
    sourceName,
    amount,
    simulated,
    receiptRows,
    reducedMotion,
  ]);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // WebGL availability is only known after initializing the external renderer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(6.7, 4.7, 9);
    camera.lookAt(0, 1.5, 0);
    scene.add(new THREE.HemisphereLight(0xfff9ed, 0x7e658b, 3));
    const key = new THREE.DirectionalLight(0xfff3d6, 3.5);
    key.position.set(-3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 4;
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.025;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd3bdff, 2.5);
    rim.position.set(4, 3, -3);
    scene.add(rim);
    const model = new THREE.Group();
    scene.add(model);
    const mat = (color: string, metalness = 0, roughness = 0.4) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness });
    const cream = mat("#e1d2b4", 0.12),
      plum = mat("#302333", 0.25),
      violet = mat("#7041c7", 0.16, 0.3),
      amber = mat("#c59751", 0.45, 0.3);
    const mesh = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x = 0,
      y = 0,
      z = 0,
      parent: THREE.Object3D = model,
    ) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (
      w: number,
      h: number,
      d: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent = model,
    ) =>
      mesh(
        new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d, 0.22) / 3),
        material,
        x,
        y,
        z,
        parent,
      );
    const cylinder = (
      r: number,
      h: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent = model,
    ) => mesh(new THREE.CylinderGeometry(r, r, h, 64), material, x, y, z, parent);
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 1024;
    textureCanvas.height = 1024;
    const ctx = textureCanvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(textureCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    let textureVersion = "";
    const drawReceipt = (count: number, stamped: boolean) => {
      const current = live.current;
      const version = `${count}-${stamped}-${current.amount}-${current.sourceName}-${current.simulated}-${JSON.stringify(current.receiptRows)}`;
      if (textureVersion === version) return;
      textureVersion = version;
      ctx.fillStyle = "#fff6df";
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.fillStyle = "#332837";
      ctx.font = "bold 75px monospace";
      ctx.fillText("DELTAMON", 70, 100);
      ctx.font = "27px monospace";
      ctx.fillText(current.simulated ? "DEMO / DEPOSIT RECORD" : "DEPOSIT RECORD", 70, 165);
      const rows = current.receiptRows ?? [
        ["01 / AUTHORIZED", "Wallet authorization recorded"],
        ["02 / SOURCE SENT", `USDC from ${current.sourceName}`],
        ["03 / MONAD READY", "USDC ready at destination"],
        ["04 / SHARES RECEIVED", `${current.amount} sdMON / simulated`],
      ];
      rows.slice(0, count).forEach(([title, detail], index) => {
        const y = 270 + index * 200;
        ctx.fillStyle = index === 3 ? "#6942bb" : "#332837";
        ctx.fillRect(70, y - 40, 884, 2);
        ctx.font = "bold 38px monospace";
        ctx.fillText(title!, 70, y + 14, 884);
        ctx.font = "26px monospace";
        ctx.fillText(detail!, 70, y + 64, 884);
      });
      if (stamped) {
        ctx.save();
        ctx.translate(840, 945);
        ctx.rotate(-0.1);
        ctx.strokeStyle = "#6942bb";
        ctx.lineWidth = 5;
        ctx.strokeRect(-115, -33, 230, 58);
        ctx.fillStyle = "#6942bb";
        ctx.font = "bold 23px monospace";
        ctx.fillText(current.simulated ? "DEMO RECEIPT" : "VAULT RECEIPT", -100, 4);
        ctx.restore();
      }
      tex.needsUpdate = true;
    };
    drawReceipt(live.current.confirmedSteps, live.current.complete);
    let moving: THREE.Object3D;
    let ticket: THREE.Mesh<THREE.PlaneGeometry> | undefined;
    let driveRoller: THREE.Mesh | undefined;
    if (concept === "press") {
      box(3.6, 0.24, 2.75, plum, 0, 0.25, 0);
      box(3.4, 0.18, 2.55, cream, 0, 0.45, 0);
      for (const x of [-1.45, 1.45]) {
        box(0.38, 2.45, 1.15, cream, x, 1.65, -0.55);
        cylinder(0.07, 2.5, amber, x, 1.6, 0.14);
        box(0.55, 0.12, 1.4, plum, x, 2.95, -0.55);
      }
      box(3.55, 0.5, 1.25, cream, 0, 2.73, -0.55);
      box(2.6, 0.23, 0.08, plum, 0, 2.77, 0.1);
      const roller = cylinder(0.48, 2.65, violet, 0, 1.46, 0.12);
      roller.geometry.rotateZ(Math.PI / 2);
      driveRoller = roller;
      mesh(new THREE.BoxGeometry(2.55, 0.045, 0.016), amber, 0, 0, 0.481, roller);
      const axle = cylinder(0.11, 3.8, amber, 0, 1.46, 0.12);
      axle.rotation.z = Math.PI / 2;
      moving = new THREE.Group();
      moving.position.set(1.94, 1.46, 0.12);
      model.add(moving);
      const wheel = mesh(new THREE.TorusGeometry(0.66, 0.08, 16, 72), plum, 0, 0, 0, moving);
      wheel.rotation.y = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const spoke = box(0.08, 1.24, 0.07, plum, 0, 0, 0, moving as THREE.Group);
        spoke.rotation.x = (i * Math.PI) / 3;
      }
      const handle = cylinder(0.115, 0.42, amber, 0.23, 0.52, 0, moving as THREE.Group);
      handle.rotation.z = Math.PI / 2;
      ticket = new THREE.Mesh(
        new THREE.PlaneGeometry(2.35, 1, 1, 48),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }),
      );
      ticket.castShadow = true;
      ticket.receiveShadow = true;
      model.add(ticket);
      for (const x of [-1.48, 1.48])
        for (const z of [-0.9, 0.9]) cylinder(0.1, 0.05, amber, x, 0.57, z);
    } else {
      cylinder(1.65, 0.23, cream, 0, 0.26, 0);
      cylinder(1.5, 0.05, amber, 0, 0.4, 0);
      cylinder(0.13, 2.95, plum, 0, 1.9, 0);
      cylinder(0.24, 0.17, amber, 0, 0.53, 0);
      moving = new THREE.Group();
      moving.position.set(0, 3.1, 0);
      model.add(moving);
      box(4.7, 0.12, 0.22, plum, 0, 0, 0, moving as THREE.Group);
      const joint = mesh(new THREE.SphereGeometry(0.24, 32, 24), amber, 0, 0, 0, moving);
      joint.scale.set(1, 1, 0.8);
      cylinder(0.023, 1.4, amber, -1.7, -0.72, 0, moving as THREE.Group);
      cylinder(0.023, 0.9, amber, 1.85, -0.47, 0, moving as THREE.Group);
      const weight = mesh(
        new THREE.TorusGeometry(0.65, 0.32, 32, 80),
        violet,
        -1.7,
        -1.82,
        0,
        moving,
      );
      weight.rotation.y = -0.22;
      const gold = box(0.86, 0.94, 0.86, amber, 1.85, -1.35, 0, moving as THREE.Group);
      gold.rotation.y = 0.18;
      box(0.3, 0.05, 0.015, plum, 1.85, -1.35, 0.46, moving as THREE.Group);
      moving.rotation.z = 0.12;
      const badge = mesh(
        new THREE.TorusGeometry(0.21, 0.025, 12, 48),
        cream,
        -1.7,
        -1.82,
        0.34,
        moving,
      );
      badge.visible = true;
    }
    const floor = mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: dark ? 0.22 : 0.13 }),
      0,
      0.1,
      0,
      scene,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    let lastPrintRun = live.current.printRun;
    let lastConfirmed = live.current.confirmedSteps;
    let feed = paperLength(lastConfirmed);
    let fromFeed = feed;
    let targetFeed = feed;
    let feedElapsed = PRESS_FEED_DURATION;
    let replaying = false;
    let replayTime = 0;
    const setPaper = (length: number, flutter = 0) => {
      if (!ticket) return;
      const position = ticket.geometry.attributes.position!;
      const uv = ticket.geometry.attributes.uv!;
      for (let i = 0; i < position.count; i++) {
        const fraction = Math.floor(i / 2) / 48;
        position.setY(i, 0.96 - fraction * 0.34 + Math.pow(fraction, 5) * (0.18 + flutter));
        position.setZ(i, -0.05 + fraction * length);
        // Existing ink travels with the leading edge; each new line emerges at the roller.
        uv.setY(i, 1 - ((1 - fraction) * length) / paperLength(4));
      }
      position.needsUpdate = true;
      uv.needsUpdate = true;
      ticket.geometry.computeVertexNormals();
    };
    setPaper(feed);
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.position.set(6.7, 4.7, 9).multiplyScalar(width / height < 1 ? 1.2 : 1);
      camera.zoom = live.current.stage === 4 ? 1.15 : 1;
      camera.lookAt(0, 1.4, 0.25);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true,
      pointer = 0,
      angle = 0,
      frame = 0,
      time = 0,
      prev = 0;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    io.observe(el);
    const move = (e: PointerEvent) => {
      pointer = ((e.clientX - el.getBoundingClientRect().left) / el.clientWidth - 0.5) * 0.22;
    };
    const leave = () => {
      pointer = 0;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      if (!visible || document.hidden) return;
      const current = live.current;
      const reduce = reduced.matches || current.reducedMotion;
      const active = !current.paused && !reduce;
      if (active) time += dt;
      if (active) angle += (pointer - angle) * 0.06;
      else if (reduce) angle = 0;
      model.rotation.y = angle;
      if (concept === "sculpture") {
        if (active)
          moving.rotation.z = 0.12 + (current.stage === 0 ? Math.sin(time * 0.7) * 0.055 : 0);
        else if (reduce) moving.rotation.z = 0.12;
      } else {
        if (current.complete && current.printRun !== lastPrintRun) {
          lastPrintRun = current.printRun;
          replaying = !reduce;
          replayTime = 0;
          if (replaying) {
            feed = paperLength(0);
            fromFeed = feed;
            targetFeed = feed;
            feedElapsed = PRESS_FEED_DURATION;
          }
        }
        let confirmed = current.confirmedSteps;
        if (replaying && active) {
          replayTime += dt;
          confirmed = Math.min(4, Math.floor(replayTime / 1.15) + 1);
          if (replayTime >= 4.6) replaying = false;
        } else if (replaying) {
          confirmed = Math.min(4, Math.floor(replayTime / 1.15) + 1);
        }
        const nextTarget = paperLength(confirmed);
        if (confirmed !== lastConfirmed || targetFeed !== nextTarget) {
          lastConfirmed = confirmed;
          fromFeed = feed;
          targetFeed = nextTarget;
          feedElapsed = 0;
        }
        if (reduce) {
          replaying = false;
          feed = paperLength(current.confirmedSteps);
          targetFeed = feed;
          feedElapsed = PRESS_FEED_DURATION;
        } else if (active) {
          feedElapsed = Math.min(PRESS_FEED_DURATION, feedElapsed + dt);
          feed = interpolatePaper(fromFeed, targetFeed, feedElapsed);
          const feeding = feedElapsed < PRESS_FEED_DURATION;
          const speed = feeding ? 3.8 : current.working ? 0.6 : 0;
          moving.rotation.x -= dt * speed;
          if (driveRoller) driveRoller.rotateX(-dt * speed);
        }
        const feeding = feedElapsed < PRESS_FEED_DURATION;
        drawReceipt(confirmed, confirmed === 4 && !feeding);
        setPaper(feed, active && feeding ? Math.sin(time * 8) * 0.028 : 0);
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      tex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [concept, dark]);
  return (
    <div
      ref={host}
      style={{ width: "100%", height: "100%" }}
      role="img"
      aria-label={
        concept === "press"
          ? "A cream and violet mechanical printing press releasing a DeltaMon entry ticket. Decorative receipt illustration."
          : "A violet ceramic ring and brass weight suspended from an intentionally tilted counterweight sculpture. Decorative, not live exposure."
      }
    >
      {failed && (
        <p>3D preview unavailable on this device. The deposit study below remains usable.</p>
      )}
    </div>
  );
}
