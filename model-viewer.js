// media/model/model.obj를 지정한 캔버스에 띄우는 3D 뷰어. 예전엔 탐색기 창
// 본문 전체를 차지했지만, 지금은 탐색기에서 model.obj를 골랐을 때만
// explorer-app.js가 불러 붙인다.
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
const METALNESS = 0.0;
// 카메라 높이 제한(도). 수평선(0도) 아래로는 못 내려가고, 최소 이만큼은
// 위에서 내려다보게 한다. START는 처음 잡히는 각도.
const MIN_ELEVATION_DEG = 15;
const START_ELEVATION_DEG = 22;

// MTL은 텍스처 파일 이름을 얻는 데만 쓴다. MTLLoader가 붙여주는 텍스처는
// 로딩 완료를 기다릴 방법이 없어서, 직접 받아 await한 뒤 머티리얼을 만든다.
function textureNameFrom(materials) {
  for (const info of Object.values(materials.materialsInfo || {})) {
    const name = info.map_kd || info.map_ka;
    if (typeof name === "string" && name) return name.trim().split(/\s+/).pop();
  }
  return null;
}

async function loadModel() {
  const materials = await new MTLLoader().setPath(MODEL_DIR).loadAsync("model.mtl");
  const textureName = textureNameFrom(materials);

  const [object, texture] = await Promise.all([
    new OBJLoader().setPath(MODEL_DIR).loadAsync("model.obj"),
    textureName ? new THREE.TextureLoader().setPath(MODEL_DIR).loadAsync(textureName) : null,
  ]);

  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: new THREE.Color(0xffffff),
    roughness: ROUGHNESS,
    metalness: METALNESS,
    side: THREE.DoubleSide,
  });

  object.traverse((child) => {
    if (!child.isMesh) return;
    const previous = Array.isArray(child.material) ? child.material : [child.material];
    for (const old of previous) old?.dispose?.();
    child.material = material;
  });

  return object;
}

// 캔버스 하나에 뷰어를 붙인다. onStatus로 로딩/실패 문구를 밖에 넘긴다.
export function mountModelViewer(canvas, { onStatus = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 물리 기반(Standard) 머티리얼이라 조명 총량이 커서, 하이라이트가 흰색으로
  // 타지 않게 톤매핑을 건다.
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
  // 좁은 창 안이라 휠 줌은 끄고(페이지 스크롤 우선) 드래그 회전만.
  controls.enableZoom = false;
  // 수평선 아래는 물론 그 바로 위 각도까지 막아서 밑면이 보이지 않게 한다.
  controls.maxPolarAngle = Math.PI / 2 - THREE.MathUtils.degToRad(MIN_ELEVATION_DEG);

  const pivot = new THREE.Group();
  scene.add(pivot);

  function resize() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 원점 기준으로 옮겨서 회전축이 모델 중심이 되게 한다.
    object.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z) || 1;
    // 세로/가로 중 더 빡빡한 쪽 기준으로 맞춰야 좁은 패널에서 잘리지 않는다.
    const fitH = size.y / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const fitW = size.x / 2 / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect;
    const distance = Math.max(fitH, fitW, radius * 0.5) * FIT_MARGIN;
    // 시작 위치도 제한 각도 안쪽에 둬야 첫 프레임에 카메라가 튀지 않는다.
    const start = THREE.MathUtils.degToRad(START_ELEVATION_DEG);
    camera.position.set(0, distance * Math.sin(start), distance * Math.cos(start));
    camera.near = distance / 100;
    camera.far = distance * 20;
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

  function start() {
    if (!raf && pivot.children.length) tick();
  }

  function stop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);

  onStatus("model.obj 불러오는 중…");
  const ready = loadModel()
    .then((object) => {
      pivot.add(object);
      resize();
      frameObject(object);
      onStatus("");
      start();
      return true;
    })
    .catch((err) => {
      console.error("[model-viewer] 모델 로드 실패", err);
      onStatus("모델을 불러올 수 없습니다.");
      return false;
    });

  // 창 밖으로 나가면(혹은 다른 파일을 고르면) 렌더 루프를 멈춘다.
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) start();
        else stop();
      }
    },
    { threshold: 0.01 }
  );
  visibility.observe(canvas);

  return { ready, start, stop, resize };
}
