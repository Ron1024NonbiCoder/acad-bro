/* Hand a text file to the browser as a download. Returns false when the
   browser refused, so the caller can tell the user instead of claiming success. */
export function downloadFile(filename, text, mime) {
  try {
    var url = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return true;
  } catch (err) {
    return false;
  }
}
