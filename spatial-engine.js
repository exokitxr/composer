import THREE from './three.module.js';
const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector4 = new THREE.Vector3();
const localVector5 = new THREE.Vector3();
const localVector2D = new THREE.Vector2();
const localQuaternion = new THREE.Quaternion();
const localRaycaster = new THREE.Raycaster();

const _getNextPowerOf2 = n => Math.pow(2, Math.ceil(Math.log(n)/Math.log(2)));
const _makePromise = () => {
  let accept, reject;
  const p = new Promise((a, r) => {
    accept = a;
    reject = r;
  });
  p.accept = accept;
  p.reject = reject;
  return p;
};
const _floorVector = v => v.set(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z));

export class XRRaycaster {
  constructor({width = 512, height = 512, pixelRatio = 1, cameraHeight = 1, cameraWidth = 1, near = 0.1, far = 300, renderer = new THREE.WebGLRenderer(), onColorRender = (target, camera) => {}, onDepthRender = (target, camera) => {}} = {}) {
    this.width = width;
    this.height = height;
    this.renderer = renderer;

    const depthBufferPixels = new Float32Array(width*pixelRatio*height*pixelRatio);
    this.depthBufferPixels = depthBufferPixels;

    const camera = new THREE.OrthographicCamera(
      cameraWidth / -2, cameraWidth / 2,
      cameraHeight / 2, cameraHeight / -2,
      near, far
    );
    this.camera = camera;

    const depthTarget = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // colorTarget.fresh = false;
    // colorTarget.freshDepthBuf = false;
    // colorTarget.freshCoordBuf = false;
    const colorTargetDepthBuf = new Float32Array(width*pixelRatio*height*pixelRatio*4); // encoded z depths
    this.colorTargetDepthBuf = colorTargetDepthBuf;
    /* const colorTargetCoordBuf = new Float32Array(width*pixelRatio*height*pixelRatio*3); // decoded xyz points
    this.colorTargetCoordBuf = colorTargetCoordBuf; */
    colorTarget.updateView = (x, y, z, q) => {
      // const position = localVector.fromArray(p);
      // const quaternion = localQuaternion.fromArray(q);

      if (camera.position.x !== x || camera.position.y !== y || camera.position.z !== z || !camera.quaternion.equals(q)) {
        // console.log('set camera', x, y, z);
        camera.position.set(x, y, z);
        camera.quaternion.copy(q);
        camera.updateMatrixWorld();
        // colorTarget.fresh = false;
      }
    };
    colorTarget.updateDepthTexture = () => {
      // if (!colorTarget.fresh) {
        onDepthRender({
          target: depthTarget,
          near,
          far,
          width,
          height,
          pixelRatio,
          matrixWorld: camera.matrixWorld.toArray(),
          projectionMatrix: camera.projectionMatrix.toArray(),
        });
        // colorTarget.fresh = true;
        // colorTarget.freshDepthBuf = false;
      // }
    };
    colorTarget.updateDepthBuffer = () => {
      // if (!colorTarget.freshDepthBuf) {
        renderer.readRenderTargetPixels(depthTarget, 0, 0, width * pixelRatio, height * pixelRatio, colorTargetDepthBuf, 0);
        // console.log('got raw depth buf', colorTargetDepthBuf);
        // colorTarget.freshDepthBuf = true;
        // colorTarget.freshCoordBuf = false;
      // }
    };
    /* const cameraOrigins = (() => {
      const origins = new Float32Array(width*height*3);
      let index = 0;
      for (let y = height-1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
          const xFactor = x / width;
          const yFactor = y / height;
          localVector.set(xFactor * 2 - 1, -yFactor * 2 + 1, (camera.near + camera.far) / (camera.near - camera.far))
            .applyMatrix4(camera.projectionMatrixInverse)
            .toArray(origins, index);
          index += 3;
        }
      }
      // console.log('use camera matrix world', camera.matrixWorld.toArray().join(','));
      return origins;
    })(); */
    colorTarget.updateDepthBufferPixels = () => {
      // if (!colorTarget.freshCoordBuf) {
        // let index3 = 0;
        let index = 0;
        let index4 = 0;
        for (let y = 0; y < height * pixelRatio; y++) {
          for (let x = 0; x < width * pixelRatio; x++) {
            let v = XRRaycaster.decodePixelDepth(colorTargetDepthBuf, index4);
            if (v > far) {
              v = Infinity;
            }
            depthBufferPixels[index] = v;
            /* localVector.fromArray(cameraOrigins, index3)
              .applyMatrix4(camera.matrixWorld)
              .add(
                localVector2.set(0, 0, -1)
                  .transformDirection(camera.matrixWorld)
                  .multiplyScalar(XRRaycaster.decodePixelDepth(colorTargetDepthBuf, index4))
              )
              .toArray(colorTargetCoordBuf, index3); */
            // index3 += 3;
            index++;
            index4 += 4;
          }
        }

        // colorTarget.freshCoordBuf = true;
      }
    // };
    colorTarget.getDepthBufferPixels = () => depthBufferPixels;
    this.colorTarget = colorTarget;
  }
  getDepthTexture() {
    return this.colorTarget.texture;
  }
  getDepthBuffer() {
    return this.colorTargetDepthBuf;
  }
  getPointCloudBuffer() {
    return this.colorTargetCoordBuf;
  }
  /* async raycast(camera, xFactor, yFactor) {
    if (xFactor >= 0 && xFactor <= 1 && yFactor >= 0 && yFactor <= 1) {
      localRaycaster.setFromCamera(localVector2D.set(xFactor * 2 - 1, -yFactor * 2 + 1), camera);

      const p = localRaycaster.ray.origin.toArray();
      const q = localQuaternion.setFromUnitVectors(localVector.set(0, 0, -1), localRaycaster.ray.direction).toArray();
      this.updateView(p, q);
      this.updateTexture();
      await XRRaycaster.nextFrame();
      this.updateDepthBuffer();

      const z = XRRaycaster.decodePixelDepth(this.colorTargetDepthBuf, 0);
      return localVector.fromArray(p)
        .add(localVector2.set(0, 0, -1).applyQuaternion(localQuaternion.fromArray(q)).multiplyScalar(z))
        .toArray();
    } else {
      return null;
    }
  } */
  updateView(x, y, z, q) {
    this.colorTarget.updateView(x, y, z, q);
  }
  updateColorTexture() {
    this.colorTarget.updateColorTexture();
  }
  updateColorBuffer() {
    this.colorTarget.updateColorBuffer();
  }
  getColorBufferPixels() {
    return this.colorTarget.getColorBufferPixels();
  }
  updateDepthTexture() {
    this.colorTarget.updateDepthTexture();
  }
  updateDepthBuffer() {
    this.colorTarget.updateDepthBuffer();
  }
  updateDepthBufferPixels() {
    this.colorTarget.updateDepthBufferPixels();
  }
  getDepthBufferPixels() {
    return this.colorTarget.getDepthBufferPixels();
  }
  render() {
    this.colorTarget.fresh = false;
  }
  static decodePixelDepth(rgba, i) {
    return rgba[i] +
      rgba[i+1] * 255.0 +
      rgba[i+2] * 255.0*255.0 +
      rgba[i+3] * 255.0*255.0*255.0;
  }
  static get decodePixelDepthGLSL() {
    return `
      float decodePixelDepth(vec4 rgba) {
        return dot(rgba, vec4(1.0, 255.0, 255.0*255.0, 255.0*255.0*255.0));
      }
    `;
  }
  static nextFrame() {
    return new Promise((accept, reject) => {
      requestAnimationFrame(accept);
    });
  }
}
export class XRChunk extends EventTarget {
  constructor(x, y, z) {
    super();

    this.object = new THREE.Object3D();
    this.object.position.set(x, y, z);
  }
  getCenter(v = new THREE.Vector3()) {
    return v.copy(this.object.position).add(new THREE.Vector3(0.5, 0.5, 0.5));
  }
}
export class XRChunker extends EventTarget {
  constructor() {
    super();

    this.chunks = [];
    this.running = false;
    this.arrayBuffer = new ArrayBuffer(2*1024*1024);

    this.worker = (() => {
      let cbs = [];
      const worker = new Worker('mc-worker.js');
      worker.onmessage = e => {
        const {data} = e;
        const {error, result} = data;
        cbs.shift()(error, result);
      };
      worker.onerror = err => {
        console.warn(err);
      };
      worker.request = (req, transfers) => new Promise((accept, reject) => {
        worker.postMessage(req, transfers);

        cbs.push((err, result) => {
          if (!err) {
            accept(result);
          } else {
            reject(err);
          }
        });
      });
      return worker;
    })();

    this._neededCoordsCache = [];
  }
  getChunkAt(x, y, z) {
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const dx = x - chunk.object.position.x;
      const dy = y - chunk.object.position.y;
      const dz = z - chunk.object.position.z;
      if (dx >= 0 && dx < 1 && dy >= 0 && dy < 1 && dz >= 0 && dz < 1) {
        return chunk;
      }
    }
    return null;
  }
  updateTransform(p, q, s) {
    const position = localVector.fromArray(p);
    const quaternion = localQuaternion.fromArray(q);
    const scale = localVector2.fromArray(s);

    const cameraCenter = _floorVector(localVector3.copy(position)).add(localVector4.set(0.5, 0.5, 0.5));

    const neededCoords = this._neededCoordsCache;
    let numNeededCoords = 0;
    const _hasNeededCoord = coord => {
      for (let i = 0; i < numNeededCoords; i++) {
        if (neededCoords[i].equals(coord)) {
          return true;
        }
      }
      return false;
    };
    const _addNeededCoord = (x, y, z) => {
      const c = _floorVector(localVector4.copy(cameraCenter).add(localVector5.set(x, y, z).applyQuaternion(quaternion)));
      if (!_hasNeededCoord(c)) {
        const index = numNeededCoords++;
        if (index >= neededCoords.length) {
          neededCoords.push(new THREE.Vector3());
        }
        neededCoords[index].copy(c);
      }
    }
    for (let z = 0; z >= -scale.z/2; z--) {
      _addNeededCoord(0, 0, z);
    }
    for (let z = -scale.z/2; z <= scale.z/2; z+=0.5) {
      for (let x = -scale.x/2; x <= scale.x/2; x+=0.5) {
        for (let y = -scale.y/2; y <= scale.y/2; y+=0.5) {
          _addNeededCoord(x, y, z);
        }
      }
    }
    for (let z = scale.z/2; z >= -scale.z/2; z-=0.5) {
      for (let x = scale.x/2; x >= -scale.x/2; x-=0.5) {
        for (let y = scale.y/2; y >= -scale.y/2; y-=0.5) {
          _addNeededCoord(x, y, z);
        }
      }
    }

    this.chunks = this.chunks.filter(chunk => {
      if (_hasNeededCoord(chunk.object.position)) {
        return true;
      } else {
        this.dispatchEvent(new MessageEvent('removechunk', {data: chunk}));
        return false;
      }
    });
    for (let i = 0; i < numNeededCoords; i++) {
      const coord = neededCoords[i];
      if (!this.getChunkAt(coord.x, coord.y, coord.z)) {
        const chunk = new XRChunk(coord.x, coord.y, coord.z);
        this.chunks.push(chunk);
        this.dispatchEvent(new MessageEvent('addchunk', {data: chunk}));
      }
    }
  }
  async updateMesh(getPointCloud) {
    if (!this.running) {
      this.running = true;

      const {width, voxelSize, marchCubesTexSize, pointCloudBuffer} = await getPointCloud();
      const marchCubesTexTriangleSize = _getNextPowerOf2(Math.sqrt(marchCubesTexSize));
      const marchCubesTexSquares = marchCubesTexSize/marchCubesTexTriangleSize;
      const chunks = this.chunks.slice();
      const chunkCoords = chunks.map(chunk => chunk.object.position.toArray());
      const res = await this.worker.request({
        method: 'computeGeometry',
        chunkCoords,
        colorTargetCoordBuf: pointCloudBuffer,
        colorTargetSize: width,
        voxelSize,
        marchCubesTexSize,
        marchCubesTexSquares,
        marchCubesTexTriangleSize,
        arrayBuffer: this.arrayBuffer,
      }, [this.arrayBuffer]);
      const {potentialsArray, positionsArray, barycentricsArray, uvsArray, uvs2Array, arrayBuffer, size} = res;
      this.arrayBuffer = arrayBuffer;
      if (size > arrayBuffer.byteLength) {
        throw new Error(`geometry buffer overflow: have ${arrayBuffer.byteLength}, need ${size}`);
      }

      for (let i = 0; i < chunks.length; i++) {

        chunks[i].dispatchEvent(new MessageEvent('update', {
          data: {
            potentials: potentialsArray[i],
            positions: positionsArray[i],
            barycentrics: barycentricsArray[i],
            uvs: uvsArray[i],
            uvs2: uvs2Array[i],
          },
        }));
      }
      this.updatePromise = _makePromise();
      await this.updatePromise;

      this.running = false;
    }
  }
  render() {
    if (this.updatePromise) {
      this.updatePromise.accept();
      this.updatePromise = null;
    }
  }
}