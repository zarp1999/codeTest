import * as THREE from 'three';
import GeoTerrainWithJGWTexture from './GeoTerrainWithJGWTexture.js';

class GeoTerrainManager {
    constructor(scene, apiBaseUrl, coordinateOffset) {
        this.scene = scene;
        this.apiBaseUrl = apiBaseUrl;
        this.referenceOffset = coordinateOffset;

        this.coordinateOffset = this.referenceOffset;

        this.terrains = new Map();
    }

    async addDem(surfaceId, revisionId, name, options = {}) {
        const terrainKey = `${surfaceId}-${revisionId}`;

        if (this.terrains.has(terrainKey)) {
            return this.terrains.get(terrainKey).terrain;
        }

        const bboxParam = options.bbox || null;
        const res = options.res || null;

        let url = `${this.apiBaseUrl}/dems/${surfaceId}/${revisionId}/geo-terrain`;

        if (bboxParam) {
            url += `?bbox=${bboxParam}`;
        }

        const Timeout = 30000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Timeout);

        let data = null;

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            data = await response.json();
        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                return null;
            }

            throw error;
        }

        if (!data) {
            return null;
        }

        const perDemOffset = options.coordinateOffset || this.referenceOffset;

        const opacity = options.opacity || 1.0;

        const terrain = new GeoTerrainWithJGWTexture(this.scene, {
            heightScale: options.heightScale || 1.0,
            coordinateOffset: perDemOffset,
            opacity,
        });

        this._loadFromElevationGrid(terrain, data);

        if (options.color) {
            terrain.setColor(options.color);
        }

        this.terrains.set(terrainKey, {
            terrain,
            surfaceId,
            revisionId,
            _res: res,
        });

        return terrain;
    }

    async addDemFromGeoTIFF(geoTiffUrl, jgwImageList, terrainKey, options = {}) {
        if (this.terrains.has(terrainKey)) {
            return this.terrains.get(terrainKey).terrain;
        }

        const perDemOffset = options.coordinateOffset || this.referenceOffset;

        const terrain = new GeoTerrainWithJGWTexture(this.scene, {
            heightScale: options.heightScale || 1.0,
            coordinateOffset: perDemOffset,
            opacity: options.opacity || 1.0,
        });

        await terrain.loadGeoTIFFWithJGWTexture(geoTiffUrl, jgwImageList);

        this.terrains.set(terrainKey, {
            terrain,
            surfaceId: null,
            revisionId: null,
        });

        return terrain;
    }

    _loadFromElevationGrid(terrain, data) {
        const { elevations, shape, bbox, res} = data;
        const [rows, cols] = shape;
        const [minX, minY, maxX, maxY] = bbox;

        const geoWidth = maxX - minX;
        const geoHeight = maxY - minY;

        const geometry = new THREE.PlaneGeometry(geoWidth, geoHeight, cols - 1, rows - 1);

        const vertices = geometry.attributes.position.array;

        let minElevation = Infinity;
        let maxElevation = -Infinity;

        for (let i = 0; i < elevations.length; i++) {
            const elevation = elevations[i];

            if (elevation !== null && elevation !== undefined && !isNaN(elevation) && isFinite(elevation)) {
                const elev = parseFloat(elevation);

                if (elev < minElevation) minElevation = elev;
                if (elev > maxElevation) maxElevation = elev;
            }
        }

        if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) {
            minElevation = 0;
            maxElevation = 0;
        }

        const offsetX = terrain.coordinateOffset.x;
        const offsetZ = terrain.coordinateOffset.z;

        const uvs = [];
        let vertexIndex = 0;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const dataIndex = row * cols + col;
                const elevation = elevations[dataIndex];

                const validElevation = elevation !== null && elevation !== undefined && !isNaN(elevation) && isFinite(elevation) ? elevation : minElevation;

                const normalizedX = col / (cols - 1);
                const normalizedZ = row / (rows - 1);

                const geoX = minX + normalizedX * geoWidth;
                const geoY = minY + normalizedZ * geoHeight;

                vertices[vertexIndex] = geoX + offsetX;
                vertices[vertexIndex + 1] = validElevation * terrain.heightScale;
                vertices[vertexIndex + 2] = -geoY + offsetZ;

                uvs.push(normalizedX, 1.0 - normalizedZ);

                vertexIndex += 3;
            }
        }

        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const minX3d = minY + offsetX;
        const maxX3d = maxY + offsetX;
        const minZ3d = -maxX + offsetZ;
        const maxZ3d = -minX + offsetZ;

        terrain.worldBbox3D = {
            minX: minX3d,
            maxX: maxX3d,
            minZ: minZ3d,
            maxZ: maxZ3d,
        };

        const position = geometry.attributes.position.array;
        const worldWidthX = maxX3d - minX3d;
        const worldWidthZ = maxZ3d - minZ3d;

        const newUvs = [];

        for (let i = 0; i < position.length; i += 3) {
            const x = position[i];
            const z = position[i + 2];

            const u = (x - minX3d) / worldWidthX;
            const v = 1.0 - (z - minZ3d) / worldWidthZ;

            newUvs.push(u, v);
        }

        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));

        terrain.createTerrainSurface(geometry, minElevation, maxElevation);
    }

    setVisible(terrainKey, visible) {
        const terrain = this.terrains.get(terrainKey);
        if (terrain) {
            terrain.setVisible(visible);
        }
    }

    setAllVisible(visible) {
        for ( const [, terrain] of this.terrains) {
            terrain.setVisible(visible);
        }
    }

    setOpacity(terrainKey, opacity) {
        const terrain = this.terrains.get(terrainKey);
        if (terrain) {
            terrain.setOpacity(opacity);
        }
    }

    setAllOpacity(opacity) {
        for ( const [, terrain] of this.terrains) {
            terrain.setOpacity(opacity);
        }
    }

    setColor(terrainKey, color) {
        const terrain = this.terrains.get(terrainKey);
        if (terrain) {
            terrain.setColor(color);
        }
    }

    setAllColor(color) {
        for ( const [, terrain] of this.terrains) {
            terrain.setColor(color);
        }
    }

    removeDem(terrainKey) {
        const terrain = this.terrains.get(terrainKey);
        if (terrain) {
            terrain.dispose();
            this.terrains.delete(terrainKey);
        }
    }

    removeAllDem() {
        for ( const [, terrain] of this.terrains) {
            terrain.dispose();
        }
        this.terrains.clear();
    }

    dispose() {
        this.removeAllDem();
    }
}

export default GeoTerrainManager;