import * as THREE from 'three';

export interface SceneRig {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  updateSunTarget(x: number, z: number): void;
}

function createSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color('#1d5fa7') },
      midColor: { value: new THREE.Color('#74b5e8') },
      horizonColor: { value: new THREE.Color('#f7d5a8') },
      sunDir: { value: new THREE.Vector3(0.55, 0.36, -0.75).normalize() },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 sunDir;
      varying vec3 vWorldDir;
      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.24, h));
        sky = mix(sky, topColor, smoothstep(0.18, 0.82, h));
        float sunDot = max(dot(dir, sunDir), 0.0);
        sky += vec3(1.0, 0.86, 0.62) * pow(sunDot, 16.0) * 0.45;
        sky += vec3(1.0, 0.96, 0.88) * pow(sunDot, 220.0) * 0.9;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

export function createGameScene(): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b9d6ec');
  scene.fog = new THREE.FogExp2('#cde0ee', 0.0012);

  scene.add(createSkyDome());

  const hemi = new THREE.HemisphereLight('#b5dcff', '#4b6837', 0.95);
  scene.add(hemi);

  const sunOffset = new THREE.Vector3(85, 68, -110);
  const sun = new THREE.DirectionalLight('#fff2dc', 2.45);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  const shadowHalf = 65;
  sun.shadow.camera.left = -shadowHalf;
  sun.shadow.camera.right = shadowHalf;
  sun.shadow.camera.top = shadowHalf;
  sun.shadow.camera.bottom = -shadowHalf;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  return {
    scene,
    sun,
    updateSunTarget(x: number, z: number): void {
      sun.target.position.set(x, 0, z);
      sun.position.set(x + sunOffset.x, sunOffset.y, z + sunOffset.z);
      sun.target.updateMatrixWorld();
    },
  };
}
