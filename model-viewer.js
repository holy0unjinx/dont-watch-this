// 문서 탐색기 창(첫 번째 window-card) 안의 미리보기 패널에서 model.obj를
// 렌더링한다. 텍스처(model_baseColor.png)가 8MB라 페이지 로드를 막지 않도록
// IntersectionObserver로 창이 화면에 들어올 때 한 번만 로드한다.
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MODEL_DIR = "media/model/";
// 1.0 = 화면에 꽉 참. 값을 키우면 카메라가 멀어져 모델이 작아진다.
const FIT_MARGIN = 1.32;
// OBJ/MTL은 Phong(Ns 250, Ks 0.5)이라 기본이 너무 반질거린다. Standard로
// 바꾸고 거칠기를 올려서 무광에 가깝게 만든다.
const ROUGHNESS = 0.92;
// 카메라 높이 제한(도). 수평선(0도) 아래로는 못 내려가고, 최소 이만큼은
// 위에서 내려다보게 한다. START는 처음 잡히는 각도.
const MIN_ELEVATION_DEG = 15;
const START_ELEVATION_DEG = 22;
const METALNESS = 0.0;
const canvas = document.getElementById("explorer-model-canvas");
const stage = canvas && canvas.closest(".explorer-preview");
const statusEl = stage && stage.querySelector(".explorer-preview-status");

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function init() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 물리 기반(Standard) 머티리얼로 바꾸면서 조명 총량이 커졌으니 하이라이트가
  // 흰색으로 타지 않게 톤매핑을 건다.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb8cc, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-2, -1, -2);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  // 스크롤 섹션 안에 있는 창이라 휠 줌은 끄고(페이지 스크롤 우선) 드래그 회전만.
  controls.enableZoom = false;
  // 수평선 아래는 물론이고 그 바로 위 각도까지 막아서, 항상 살짝 위에서
  // 내려다보는 시점만 허용한다(모델 밑면이 절대 안 보임).
  controls.maxPolarAngle = Math.PI / 2 - THREE.MathUtils.degToRad(MIN_ELEVATION_DEG);

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const pivot = new THREE.Group();
  scene.add(pivot);

  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 원점 기준으로 옮겨서 회전축이 모델 중심이 되게 한다.
    object.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z) || 1;
    // 세로/가로 중 더 빡빡한 쪽 기준으로 맞춰야 좁은 패널에서 잘리지 않는다.
    const fitH = (size.y / 2) / Math.tan((camera.fov * Math.PI) / 360);
    const fitW = (size.x / 2) / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect;
    const dist = Math.max(fitH, fitW, radius * 0.5) * FIT_MARGIN;
    // 시작 위치도 제한 각도 안쪽에 둬야 OrbitControls가 첫 프레임에
    // 카메라를 끌어올리며 튀지 않는다.
    const start = THREE.MathUtils.degToRad(START_ELEVATION_DEG);
    camera.position.set(0, dist * Math.sin(start), dist * Math.cos(start));
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  let raf = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }

  resize();
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }

  setStatus("model.obj 불러오는 중…");
  new MTLLoader()
    .setPath(MODEL_DIR)
    .loadAsync("model.mtl")
    .then((materials) => {
      materials.preload();
      return new OBJLoader()
        .setMaterials(materials)
        .setPath(MODEL_DIR)
        .loadAsync("model.obj");
    })
    .then((object) => {
      object.traverse((child) => {
        const material = child.isMesh && child.material;
        if (!material) return;
        const list = Array.isArray(material) ? material : [material];
        const converted = list.map((mat) => {
          if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
          const std = new THREE.MeshStandardMaterial({
            name: mat.name,
            map: mat.map || null,
            color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
            roughness: ROUGHNESS,
            metalness: METALNESS,
            side: THREE.DoubleSide,
          });
          mat.dispose();
          return std;
        });
        child.material = Array.isArray(material) ? converted : converted[0];
      });
      pivot.add(object);
      frameObject(object);
      setStatus("");
      stage.classList.add("is-ready");
      tick();
    })
    .catch((err) => {
      console.error("[model-viewer] 모델 로드 실패", err);
      setStatus("모델을 불러올 수 없습니다.");
      cancelAnimationFrame(raf);
    });

  // 창이 화면에서 벗어나면 렌더 루프를 멈춰서 배터리/GPU 낭비를 막는다.
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!raf && pivot.children.length) tick();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      }
    },
    { threshold: 0.01 }
  );
  visibility.observe(canvas);
}

if (canvas) {
  const start = new IntersectionObserver(
    (entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      init();
    },
    { rootMargin: "200px" }
  );
  start.observe(canvas);
}
