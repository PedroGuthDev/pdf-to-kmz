let _jsZipPromise = null;

async function getJSZip() {
  if (!_jsZipPromise) {
    _jsZipPromise = (async () => {
      if (typeof process !== 'undefined' && process.versions?.node) {
        return (await import('jszip')).default;
      }
      return (
        await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')
      ).default;
    })();
  }
  return _jsZipPromise;
}

/**
 * @param {string} kmlString
 * @returns {Promise<Blob>}
 */
export async function packageKmz(kmlString) {
  if (typeof kmlString !== 'string' || kmlString.trim() === '') {
    throw new Error('packageKmz requires a non-empty KML string');
  }
  const JSZip = await getJSZip();
  const zip = new JSZip();
  zip.file('doc.kml', kmlString);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
