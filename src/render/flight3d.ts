import * as THREE from 'three';
import type {Point3} from '../fold/geometry3d';
import type {Flight} from '../aero/integrator';

/**
 * v5 可选三维视图(Phase 05,PLAN.md M4 选型 Three.js)。
 *
 * 架构红线(docs/PHASES.md 冲突修订第 2 条):渲染层只消费纯数据——
 * 折叠完成态 3D 面片(FoldState.viewFaces3d,米制)与飞行采样(Flight),
 * 不从 aero/ 导入任何运行时函数,不反推任何物理量。Canvas 2D 仍是默认视图。
 */

/** 飞行坐标 (x 顺风, y 向上, z 向右) → three 坐标 (X=z, Y=y, Z=x)。 */
function toThree(p: {x: number; y: number; z?: number}): [number, number, number] {
  return [p.z ?? 0, p.y, p.x];
}

/** 凸多边形扇形三角化面片 → BufferGeometry(仅供展示)。 */
function facesToGeometry(faces: readonly (readonly Point3[])[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    const [a, ...rest] = face;
    for (let i = 0; i + 1 < rest.length; i++) {
      for (const p of [a, rest[i], rest[i + 1]]) positions.push(...toThree(p));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function samplesToPoints(flight: Flight, upto?: number): THREE.Vector3[] {
  return flight.samples
    .filter(s => upto === undefined || s.t <= upto)
    .map(s => new THREE.Vector3(...toThree(s)));
}

export type Flight3DController = {
  /** 展示折叠完成态纸面网格(米制凸面片)。 */
  setPlane(faces: readonly (readonly Point3[])[]): void;
  /** 展示弹道与姿态:actual 为 null 时展示预演虚线;elapsed 驱动飞机标记。 */
  setTrajectory(actual: Flight | null, preview: Flight, ghost: Flight | null, elapsed: number): void;
  resize(): void;
  dispose(): void;
};

export function createFlight3DView(canvas: HTMLCanvasElement): Flight3DController | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
  } catch {
    return null; // WebGL 不可用 → 调用方回退 Canvas 2D
  }
  renderer.setClearColor('#8FC7E8');

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#7FA86B', 1.1));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(8, 14, -6);
  scene.add(sun);

  // 地面参考网格(米制;草地色,与侧视图的地面一致)
  const grid = new THREE.GridHelper(60, 60, '#4C6B3F', '#7FA86B');
  grid.position.y = 0;
  scene.add(grid);

  // 相机:轨道角拖拽 + 滚轮缩放(不引 OrbitControls,减少依赖面)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
  const target = new THREE.Vector3(0, 1.5, 12);
  let azimuth = -0.9;
  let polar = 1.15;
  let radius = 26;
  const applyCamera = () => {
    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.cos(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.sin(azimuth),
    );
    camera.lookAt(target);
  };
  applyCamera();

  const planeGroup = new THREE.Group();
  scene.add(planeGroup);
  const marker = new THREE.Group();
  const markerMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.5, 10),
    new THREE.MeshLambertMaterial({color: '#1F3A5F'}),
  );
  markerMesh.rotation.x = Math.PI / 2; // 锥尖指向 +Z(顺风)
  marker.add(markerMesh);
  scene.add(marker);
  marker.visible = false;

  const previewLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({color: '#1F3A5F', transparent: true, opacity: 0.45, dashSize: 0.4, gapSize: 0.3}),
  );
  const ghostLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({color: '#6B7280', transparent: true, opacity: 0.6, dashSize: 0.3, gapSize: 0.4}),
  );
  const actualLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color: '#1F3A5F'}),
  );
  scene.add(previewLine, ghostLine, actualLine);

  const setLine = (line: THREE.Line, points: THREE.Vector3[]) => {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    line.computeLineDistances();
    line.visible = points.length >= 2;
  };

  const resize = () => {
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    renderer.setSize(width, height, false);
    camera.aspect = Math.max(0.2, width / Math.max(1, height));
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };

  // 轨道交互:拖拽改方位角/极角,滚轮缩放
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    azimuth -= (e.clientX - lastX) * 0.008;
    polar = Math.min(1.52, Math.max(0.18, polar - (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
    applyCamera();
    renderer.render(scene, camera);
  };
  const onUp = () => {
    dragging = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    radius = Math.min(90, Math.max(4, radius * (1 + Math.sign(e.deltaY) * 0.12)));
    applyCamera();
    renderer.render(scene, camera);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, {passive: false});
  const onWindowResize = () => resize();
  window.addEventListener('resize', onWindowResize);

  const render = () => renderer.render(scene, camera);

  return {
    setPlane(faces) {
      planeGroup.clear();
      const geometry = facesToGeometry(faces);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshLambertMaterial({color: '#FAF6EE', side: THREE.DoubleSide}),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({color: '#1F3A5F'}),
      );
      planeGroup.add(mesh, edges);
      planeGroup.position.set(0, 1.5, 0);
      render();
    },
    setTrajectory(actual, preview, ghost, elapsed) {
      if (!actual) {
        setLine(previewLine, samplesToPoints(preview));
        setLine(actualLine, []);
        const end = preview.samples[preview.samples.length - 1];
        marker.position.set(...toThree(end));
        marker.visible = true;
      } else {
        setLine(previewLine, []);
        const points = samplesToPoints(actual, elapsed);
        setLine(actualLine, points);
        const frame = [...actual.samples].reverse().find(s => s.t <= elapsed) ?? actual.samples[0];
        marker.position.set(...toThree(frame));
        // 姿态:航向 ψ 绕 Y,俯仰 θ 绕 X(抬头为负旋转),横滚 φ 绕 Z(右翼下为负)
        marker.rotation.order = 'YXZ';
        marker.rotation.set(-(frame.pitch ?? 0), frame.psi ?? 0, -(frame.phi ?? 0));
        marker.visible = true;
        target.set(marker.position.x * 0.35, Math.max(1.5, marker.position.y * 0.5), marker.position.z * 0.35 + 10);
        applyCamera();
      }
      setLine(ghostLine, ghost ? samplesToPoints(ghost) : []);
      render();
    },
    resize,
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onWindowResize);
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(m => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    },
  };
}
