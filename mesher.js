import THREE from './three.module.js';
import maxrects from './maxrects-packer.min.js';

const NUM_POSITIONS = 2 * 1024 * 1024;
const TEXTURE_SIZE = 4*1024;
const CHUNK_SIZE = 16;

const makeGlobalMaterial = () => new THREE.MeshStandardMaterial({
  map: null,
  color: 0xFFFFFF,
  vertexColors: true,
  transparent: true,
  alphaTest: 0.5,
});
const makeTexture = (i) => {
  const t = new THREE.Texture(i);
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
};

const _makeWasmWorker = () => {
  let cbs = [];
  const w = new Worker('mc-worker.js');
  w.onmessage = e => {
    const {data} = e;
    const {error, result} = data;
    cbs.shift()(error, result);
  };
  w.onerror = err => {
    console.warn(err);
  };
  w.request = (req, transfers) => new Promise((accept, reject) => {
    w.postMessage(req, transfers);

    cbs.push((err, result) => {
      if (!err) {
        accept(result);
      } else {
        reject(err);
      }
    });
  });
  return w;
};
const worker = _makeWasmWorker();

class Mesher {
  constructor(renderer) {
    this.renderer = renderer;

    this.positionsIndex = 0;
    this.normalsIndex = 0;
    this.colorsIndex = 0;
    this.uvsIndex = 0;
    this.idsIndex = 0;
    this.currentId = 0;
    this.globalMaterial = null
    this.currentMesh = null;
    this.packer = null;
    this.meshes = [];
    this.aabb = new THREE.Box3();

    this.reset();
  }
  reset() {
    this.positionsIndex = 0;
    this.normalsIndex = 0;
    this.colorsIndex = 0;
    this.uvsIndex = 0;
    this.idsIndex = 0;
    this.currentId = 0;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_POSITIONS*3);
    const positionsAttribute = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', positionsAttribute);
    const normals = new Float32Array(NUM_POSITIONS*3);
    const normalsAttribute = new THREE.BufferAttribute(normals, 3);
    geometry.setAttribute('normal', normalsAttribute);
    const colors = new Float32Array(NUM_POSITIONS*3);
    const colorsAttribute = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorsAttribute);
    const uvs = new Float32Array(NUM_POSITIONS*2);
    const uvsAttribute = new THREE.BufferAttribute(uvs, 2);
    geometry.setAttribute('uv', uvsAttribute);
    const ids = new Uint32Array(NUM_POSITIONS);
    const idsAttribute = new THREE.BufferAttribute(ids, 1);
    geometry.setAttribute('id', idsAttribute);
    geometry.setDrawRange(0, 0);

    this.globalMaterial = makeGlobalMaterial();

    const mesh = new THREE.Mesh(geometry, this.globalMaterial);
    mesh.frustumCulled = false;
    this.currentMesh = mesh;
    this.packer = new maxrects.MaxRectsPacker(TEXTURE_SIZE, TEXTURE_SIZE, 0, {
      smart: true,
      pot: true,
      square: false,
      allowRotation: false,
      tag: false,
      // border: 10,
      border: 0,
    });
    this.packer.images = [];
  }
  pushAtlasImage(image, currentId) {
    let spec = this.packer.images.find(o => o.image === image);
    const hadSpec = !!spec;
    if (!spec) {
      spec = {
        image,
        currentIds: [],
      };
      this.packer.images.push(spec);
    }
    spec.currentIds.push(currentId);

    if (!hadSpec) {
      if (image.width > 512) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512*image.height/image.width;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        image = canvas;
      } else if (image.height > 512) {
        const canvas = document.createElement('canvas');
        canvas.width = 512*image.height/image.width;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        image = canvas;
      }
      this.packer.add(image.width, image.height, spec);
    }
  }
  addMesh(o) {
    this.meshes.push(o);
    o.aabb = new THREE.Box3().setFromObject(o);
    o.aabb.min.x = Math.floor(o.aabb.min.x/CHUNK_SIZE)*CHUNK_SIZE;
    o.aabb.max.x = Math.ceil(o.aabb.max.x/CHUNK_SIZE)*CHUNK_SIZE;
    o.aabb.min.z = Math.floor(o.aabb.min.z/CHUNK_SIZE)*CHUNK_SIZE;
    o.aabb.max.z = Math.ceil(o.aabb.max.z/CHUNK_SIZE)*CHUNK_SIZE;
    this.aabb.union(o.aabb);
  }
  mergeMeshGeometry(o, mergeMaterial, forceUvs) {
    const {geometry, material} = this.currentMesh;
    const positionsAttribute = geometry.attributes.position;
    const positions = positionsAttribute.array;
    const normalsAttribute = geometry.attributes.normal;
    const normals = normalsAttribute.array;
    const colorsAttribute = geometry.attributes.color;
    const colors = colorsAttribute.array;
    const uvsAttribute = geometry.attributes.uv;
    const uvs = uvsAttribute.array;
    const idsAttribute = geometry.attributes.id;
    const ids = idsAttribute.array;

    o.geometry.applyMatrix4(o.matrixWorld);
    if (o.geometry.index) {
      o.geometry = o.geometry.toNonIndexed();
    }
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const {map} = mat;

    new Float32Array(positions.buffer, positions.byteOffset + this.positionsIndex*Float32Array.BYTES_PER_ELEMENT, o.geometry.attributes.position.array.length)
      .set(o.geometry.attributes.position.array);
    positionsAttribute.updateRange.offset = this.positionsIndex;
    positionsAttribute.updateRange.count = o.geometry.attributes.position.array.length;
    this.positionsIndex += o.geometry.attributes.position.array.length;

    new Float32Array(normals.buffer, normals.byteOffset + this.normalsIndex*Float32Array.BYTES_PER_ELEMENT, o.geometry.attributes.normal.array.length)
      .set(o.geometry.attributes.normal.array);
    normalsAttribute.updateRange.offset = this.normalsIndex;
    normalsAttribute.updateRange.count = o.geometry.attributes.normal.array.length;
    this.normalsIndex += o.geometry.attributes.normal.array.length;

    colorsAttribute.updateRange.offset = this.colorsIndex;
    colorsAttribute.updateRange.count = o.geometry.attributes.position.array.length;
    if (o.geometry.attributes.color) {
      for (let i = 0; i < o.geometry.attributes.color.array.length; i += o.geometry.attributes.color.itemSize) {
        colors[this.colorsIndex++] = o.geometry.attributes.color.array[i];
        if (o.geometry.attributes.color.itemSize >= 2) {
          colors[this.colorsIndex++] = o.geometry.attributes.color.array[i+1];
        } else {
          this.colorsIndex++;
        }
        if (o.geometry.attributes.color.itemSize >= 3) {
          colors[this.colorsIndex++] = o.geometry.attributes.color.array[i+2];
        } else {
          this.colorsIndex++;
        }
      }
    } else {
      if (o.geometry.groups.length > 0) {
        for (let i = 0; i < o.geometry.groups.length; i++) {
          const group = o.geometry.groups[i];
          const {start, count, materialIndex} = group;
          const material = o.material[materialIndex];
          for (let j = start; j < start + count; j++) {
            colors[this.colorsIndex + j*3] = material.color.r;
            colors[this.colorsIndex + j*3 + 1] = material.color.g;
            colors[this.colorsIndex + j*3 + 2] = material.color.b;
          }
        }
        this.colorsIndex += o.geometry.attributes.position.array.length;
      } else {
        const material = Array.isArray(o.material) ? o.material[0] : o.material;
        for (let i = 0; i < o.geometry.attributes.position.array.length; i += 3) {
          colors[this.colorsIndex++] = material.color.r;
          colors[this.colorsIndex++] = material.color.g;
          colors[this.colorsIndex++] = material.color.b;
        }
      }
    }

    if (((map && map.image) || forceUvs) && o.geometry.attributes.uv) { // XXX won't be picked up on the second pass
      if (mergeMaterial) {
        this.pushAtlasImage(map.image, this.currentId);
      }

    // if (o.geometry.attributes.uv) {
      new Float32Array(uvs.buffer, uvs.byteOffset + this.uvsIndex*Float32Array.BYTES_PER_ELEMENT, o.geometry.attributes.uv.array.length)
        .set(o.geometry.attributes.uv.array);
      uvsAttribute.updateRange.offset = this.uvsIndex;
      uvsAttribute.updateRange.count = o.geometry.attributes.uv.array.length;
      this.uvsIndex += o.geometry.attributes.uv.array.length;
    } else {
      this.uvsIndex += o.geometry.attributes.position.array.length/3*2;
    }

    if (o.geometry.attributes.id) {
      new Uint32Array(ids.buffer, ids.byteOffset + this.idsIndex*Uint32Array.BYTES_PER_ELEMENT, o.geometry.attributes.id.array.length)
        .set(o.geometry.attributes.id.array);
      this.idsIndex += o.geometry.attributes.id.array.length;
    } else {
      new Uint32Array(ids.buffer, ids.byteOffset + this.idsIndex*Uint32Array.BYTES_PER_ELEMENT, o.geometry.attributes.position.array.length/3)
        .fill(this.currentId);
      this.idsIndex += o.geometry.attributes.position.array.length/3;
      this.currentId++;
    }

    positionsAttribute.needsUpdate = true;
    this.renderer.attributes.update(positionsAttribute, 34962);
    normalsAttribute.needsUpdate = true;
    this.renderer.attributes.update(normalsAttribute, 34962);
    colorsAttribute.needsUpdate = true;
    this.renderer.attributes.update(colorsAttribute, 34962);
    uvsAttribute.needsUpdate = true;
    this.renderer.attributes.update(uvsAttribute, 34962);
    geometry.setDrawRange(0, this.positionsIndex/3);
  }
  mergeMeshGeometryScene(o, mergeMaterial, forceUvs) {
    o.updateMatrixWorld();
    o.traverse(o => {
      if (o.isMesh) {
        this.mergeMeshGeometry(o, mergeMaterial, forceUvs);
      }
    });
  }
  async decimateMesh(factor) {
    const {currentMesh} = this;

    const positions = new Float32Array(currentMesh.geometry.attributes.position.array.buffer, currentMesh.geometry.attributes.position.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const normals = new Float32Array(currentMesh.geometry.attributes.normal.array.buffer, currentMesh.geometry.attributes.normal.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const colors = new Float32Array(currentMesh.geometry.attributes.color.array.buffer, currentMesh.geometry.attributes.color.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const uvs = new Float32Array(currentMesh.geometry.attributes.uv.array.buffer, currentMesh.geometry.attributes.uv.array.byteOffset, currentMesh.geometry.drawRange.count*2);
    const ids = new Uint32Array(currentMesh.geometry.attributes.id.array.buffer, currentMesh.geometry.attributes.id.array.byteOffset, currentMesh.geometry.drawRange.count);

    const arrayBuffer = new ArrayBuffer(2 * 1024 * 1024);
    const res = await worker.request({
      method: 'decimate',
      positions,
      normals,
      colors,
      uvs,
      ids,
      minTris: positions.length/9 * factor,
      // minTris: positions.length/9,
      aggressiveness: 7,
      base: 0.000000001,
      iterationOffset: 3,
      arrayBuffer,
    }, [arrayBuffer]);

    currentMesh.geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    currentMesh.geometry.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    currentMesh.geometry.setAttribute('color', new THREE.BufferAttribute(res.colors, 3));
    currentMesh.geometry.setAttribute('uv', new THREE.BufferAttribute(res.uvs, 2));
    currentMesh.geometry.setAttribute('id', new THREE.BufferAttribute(res.ids, 1));
    currentMesh.geometry.setIndex(new THREE.BufferAttribute(res.indices, 1));
    currentMesh.geometry.setDrawRange(0, Infinity);

    currentMesh.aabb = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.aabb.min.x = Math.floor(currentMesh.aabb.min.x/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.max.x = Math.ceil(currentMesh.aabb.max.x/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.min.z = Math.floor(currentMesh.aabb.min.z/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.aabb.max.z = Math.ceil(currentMesh.aabb.max.z/CHUNK_SIZE)*CHUNK_SIZE;
    currentMesh.packer = this.packer;

    currentMesh.x = 0;
    currentMesh.z = 0;

    return currentMesh;
  }
  repackTexture() {
    const {currentMesh, globalMaterial, packer} = this;

    const canvas = document.createElement('canvas');
    canvas.width = packer.width;
    canvas.height = packer.height;
    packer.repack(false);
    if (packer.bins.length > 0) {
      const {bins: [{rects}]} = packer;

      const scale = packer.width/canvas.width;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFF';
      ctx.fillRect(0, 0, 1, 1);

      const rectById = [];
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        let {x, y, width: w, height: h, data: {image, currentIds}} = rect;
        x++;

        ctx.drawImage(image, x/scale, y/scale, w/scale, h/scale);

        for (let i = 0; i < currentIds.length; i++) {
          const currentId = currentIds[i];
          rectById[currentId] = rect;
        }
      }

      const uvs = currentMesh.geometry.attributes.uv.array;
      const ids = currentMesh.geometry.attributes.id.array;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const rect = rectById[id];

        if (rect) {
          let {x, y, width: w, height: h} = rect;
          x++;

          while (ids[i] === id) {
            let u = uvs[i*2];
            let v = uvs[i*2+1];
            if (u !== 0 || v !== 0) {
              u = Math.min(Math.max(u, 0), 1);
              v = Math.min(Math.max(v, 0), 1);
              u = (x + u*w)/packer.width;
              v = (y + v*h)/packer.height;
            }
            uvs[i*2] = u;
            uvs[i*2+1] = v;

            i++;
          }
          i--;
        }
      }
      currentMesh.geometry.attributes.uv.updateRange.offset = 0;
      currentMesh.geometry.attributes.uv.updateRange.count = -1;
      currentMesh.geometry.attributes.uv.needsUpdate = true;
      globalMaterial.map = makeTexture(canvas);
      globalMaterial.needsUpdate = true;
    }
  }
  async chunkMesh(x, z) {
    const {currentMesh, globalMaterial} = this;

    const positions = new Float32Array(currentMesh.geometry.attributes.position.array.buffer, currentMesh.geometry.attributes.position.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const normals = new Float32Array(currentMesh.geometry.attributes.normal.array.buffer, currentMesh.geometry.attributes.normal.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const colors = new Float32Array(currentMesh.geometry.attributes.color.array.buffer, currentMesh.geometry.attributes.color.array.byteOffset, currentMesh.geometry.drawRange.count*3);
    const uvs = new Float32Array(currentMesh.geometry.attributes.uv.array.buffer, currentMesh.geometry.attributes.uv.array.byteOffset, currentMesh.geometry.drawRange.count*2);
    const ids = new Uint32Array(currentMesh.geometry.attributes.id.array.buffer, currentMesh.geometry.attributes.id.array.byteOffset, currentMesh.geometry.drawRange.count);
    // const indices = currentMesh.geometry.index.array;
    const indices = new Uint32Array(positions.length/3);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = i;
    }

    const mins = [x, 0, z];
    const maxs = [x+CHUNK_SIZE, 0, z+CHUNK_SIZE];
    const arrayBuffer = new ArrayBuffer(10 * 1024 * 1024);
    const res = await worker.request({
      method: 'chunkOne',
      positions,
      normals,
      colors,
      uvs,
      ids,
      indices,
      mins,
      maxs,
      arrayBuffer,
    }, [arrayBuffer]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(res.colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(res.uvs, 2));
    geometry.setAttribute('id', new THREE.BufferAttribute(res.ids, 1));
    // geometry.setIndex(new THREE.BufferAttribute(res.indices[i], 1));
    // geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, globalMaterial);
    mesh.frustumCulled = false;

    mesh.x = x/CHUNK_SIZE;
    mesh.z = z/CHUNK_SIZE;

    return mesh;
  }
  async getChunks() {
    const {currentMesh, packer, globalMaterial} = this;

    let chunkWeights = {};
    const _getMeshesInChunk = (x, z) => {
      x += CHUNK_SIZE/2;
      z += CHUNK_SIZE/2;
      return this.meshes.filter(m => m.aabb.min.x <= x && m.aabb.max.x >= x && m.aabb.min.z <= z && m.aabb.max.z >= z);
    };
    for (let x = this.aabb.min.x; x < this.aabb.max.x; x += CHUNK_SIZE) {
      for (let z = this.aabb.min.z; z < this.aabb.max.z; z += CHUNK_SIZE) {
        const k = x + ':' + z;
        if (chunkWeights[k] === undefined) {
          chunkWeights[k] = _getMeshesInChunk(x, z).length;
        }
      }
    }
    const meshBudgets = this.meshes.map(m => {
      let budget = 0;
      for (let x = m.aabb.min.x; x < m.aabb.max.x; x += CHUNK_SIZE) {
        for (let z = m.aabb.min.z; z < m.aabb.max.z; z += CHUNK_SIZE) {
          const k = x + ':' + z;
          budget += 1/chunkWeights[k];
        }
      }
      return budget;
    });
    // console.log('got mesh budgets', meshBudgets);
    /* const extents = [];
    let seenIndices = {};
    const _getMeshesInChunk = (x, z) => {
      const chunkBox = new THREE.Box3(
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x+1, 0, z+1)
      );
      return this.meshes.filter(m => m.aabb.intersectsBox(chunkBox));
    };
    for (let x = Math.floor(this.aabb.min.x); x < Math.ceil(this.aabb.max.x); x++) {
      for (let z = Math.floor(this.aabb.min.z); z < Math.ceil(this.aabb.max.z); z++) {
        const k = x + ':' + z;
        if (!seenIndices[k]) {
          const queue = _getMeshesInChunk(x, z);
          const closure = [];
          const closureChunks = [{x, z}];
          while (queue.length > 0) {
            const mesh = queue.pop();
            closure.push(mesh);
            for (let x = Math.floor(mesh.aabb.min.x); x < Math.ceil(mesh.aabb.max.x); x++) {
              for (let z = Math.floor(mesh.aabb.min.z); z < Math.ceil(mesh.aabb.max.z); z++) {
                const k = x + ':' + z;
                if (!seenIndices[k]) {
                  const meshes = _getMeshesInChunk(x, z);
                  if (meshes.length > 0) {
                    queue.push.apply(queue, meshes);
                    closureChunks.push({x, z});
                  }
                  seenIndices[k] = true;
                }
              }
            }
          }
          if (closure.length > 0) {
            extents.push({
              meshes: closure,
              chunks: closureChunks,
            });
          }

          seenIndices[k] = true;
        }
      }
    } */
    console.log('got mesh budgets', meshBudgets.slice(0, 10));

    const decimatedMeshes = [];
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      this.reset();
      this.mergeMeshGeometryScene(mesh, true, false);
      const decimatedMesh = await this.decimateMesh(0.5);
      decimatedMeshes.push(decimatedMesh);
    }
    this.meshes = decimatedMeshes;

    console.log('got decimated meshes', decimatedMeshes);
    // debugger;
    // return this.meshes;

    const chunkMeshes = [];
    for (let x = this.aabb.min.x; x < this.aabb.max.x; x += CHUNK_SIZE) {
      for (let z = this.aabb.min.z; z < this.aabb.max.z; z += CHUNK_SIZE) {
        console.log('chunk', x, z);
        const meshes = _getMeshesInChunk(x, z);
        if (meshes.length > 0) {
          this.reset();

          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];

            this.mergeMeshGeometryScene(mesh, false, true);

            const {packer} = mesh;
            for (let j = 0; j < packer.images.length; j++) {
              const {image, currentIds} = packer.images[j];
              for (let k = 0; k < currentIds.length; k++) {
                this.pushAtlasImage(image, currentIds[k]);
              }
            }
          }
          this.repackTexture();
          const chunkMesh = await this.chunkMesh(x, z);
          chunkMeshes.push(chunkMesh);
        }
      }
    }
    this.meshes = chunkMeshes;

    console.log('got chunk meshes', chunkMeshes);
    // document.body.appendChild(chunkMeshes[0].material.map.image);

    return this.meshes;
  }
}

export {
  Mesher,
  makeGlobalMaterial,
  makeTexture,
  CHUNK_SIZE,
};