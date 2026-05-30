import { createDxfCloudClient } from "./dxf-cloud-client.js";

function bboxArea(b) {
  if (!b) return Infinity;
  const dLat = Math.max(0, (b.maxLat ?? 0) - (b.minLat ?? 0));
  const dLon = Math.max(0, (b.maxLon ?? 0) - (b.minLon ?? 0));
  return dLat * dLon;
}

function pickRegionByGps(regions, lat, lon) {
  const hits = (regions ?? []).filter((r) => {
    const b = r?.bboxLatLon;
    if (!b) return false;
    return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
  });
  if (!hits.length) return null;
  hits.sort((a, b) => bboxArea(a.bboxLatLon) - bboxArea(b.bboxLatLon));
  return hits[0];
}

function manifestFromRecord(record) {
  const {
    crs,
    bboxUtm,
    bboxLatLon,
    posts,
    cableEdges,
    rbushDump,
    parserVersion,
    uploadedAt,
    id,
    name,
  } = record;
  return {
    crs,
    bboxUtm,
    bboxLatLon,
    posts,
    cableEdges,
    rbushDump,
    parserVersion,
    uploadedAt,
    id,
    name,
  };
}

function mergeRegionLists(cloudList, localList) {
  const byId = new Map();
  for (const r of localList ?? []) byId.set(r.id, { ...r, source: "local" });
  for (const r of cloudList ?? []) {
    const prev = byId.get(r.id);
    byId.set(r.id, {
      ...prev,
      ...r,
      source: prev ? "local+cloud" : "cloud",
      uploadedAt: Math.max(prev?.uploadedAt ?? 0, r.uploadedAt ?? 0) || r.uploadedAt,
    });
  }
  return [...byId.values()].sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
}

export function createHybridRegionLibrary(localLibrary, cloudClient) {
  let cloudEnabled = false;

  async function ensureCloud() {
    if (!cloudClient) return false;
    if (cloudEnabled) return true;
    const probe = await cloudClient.probe();
    cloudEnabled = Boolean(probe.ok);
    return cloudEnabled;
  }

  return {
    get cloudEnabled() {
      return cloudEnabled;
    },

    async refreshCloudStatus() {
      cloudEnabled = false;
      return ensureCloud();
    },

    async addRegion(name, dxfBlob) {
      const record = await localLibrary.addRegion(name, dxfBlob);
      if (!(await ensureCloud())) return record;

      try {
        await cloudClient.uploadRegion({
          name: record.id,
          dxfFile: dxfBlob,
          manifest: manifestFromRecord(record),
        });
      } catch (err) {
        console.warn("[dxf-cloud] upload failed:", err);
      }
      return record;
    },

    async listRegions() {
      const local = await localLibrary.listRegions();
      if (!(await ensureCloud())) return local;
      try {
        const cloud = await cloudClient.listRegions();
        return mergeRegionLists(cloud, local);
      } catch (err) {
        console.warn("[dxf-cloud] list failed:", err);
        return local;
      }
    },

    async lookupByGps(lat, lon) {
      const local = await localLibrary.lookupByGps(lat, lon);
      if (local) return local;

      if (!(await ensureCloud())) return null;
      try {
        const cloudList = await cloudClient.listRegions();
        const hit = pickRegionByGps(cloudList, lat, lon);
        if (!hit) return null;
        return this.getRegionWithIndex(hit.id);
      } catch (err) {
        console.warn("[dxf-cloud] lookup failed:", err);
        return null;
      }
    },

    async getRegionWithIndex(id) {
      let region = await localLibrary.getRegionWithIndex(id);
      if (region) return region;

      if (!(await ensureCloud())) return null;
      try {
        const manifest = await cloudClient.getRegion(id);
        if (!manifest) return null;

        const sourceDxf = await cloudClient.fetchDxfBlob(id);

        await localLibrary.importRegionFromManifest(manifest, sourceDxf);
        return localLibrary.getRegionWithIndex(id);
      } catch (err) {
        console.warn("[dxf-cloud] hydrate failed:", err);
      }
      return null;
    },

    async deleteRegion(name) {
      await localLibrary.deleteRegion(name);
      if (!(await ensureCloud())) return;
      try {
        await cloudClient.deleteRegion(name);
      } catch (err) {
        console.warn("[dxf-cloud] delete failed:", err);
      }
    },
  };
}

export function createDefaultHybridRegionLibrary(localLibrary) {
  const cloud = createDxfCloudClient();
  return createHybridRegionLibrary(localLibrary, cloud);
}
