const fs = require('fs');
const PDFParser = require('pdf2json');

const files = fs.readdirSync('.').filter(f => f.includes('INFOVIAS'));
const pdfFile = files[0];
console.log('Processing:', pdfFile);

const pdfParser = new PDFParser();

function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch(e) {
    return str;
  }
}

pdfParser.on('pdfParser_dataError', errData => console.error(errData.parserError));
pdfParser.on('pdfParser_dataReady', pdfData => {
  const pages = pdfData.Pages;
  console.log('Total pages:', pages.length);
  
  pages.forEach((page, pageIdx) => {
    console.log(`\n=== PAGE ${pageIdx + 1} ===`);
    const texts = page.Texts || [];
    texts.forEach(textItem => {
      const text = textItem.R.map(r => safeDecode(r.T)).join('');
      const x = textItem.x;
      const y = textItem.y;
      if (text.trim()) {
        console.log(`[${x.toFixed(1)}, ${y.toFixed(1)}] ${text}`);
      }
    });
  });
});

pdfParser.loadPDF(pdfFile);
