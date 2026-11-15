// Copy button for the connector address on the "Hansora Automation in ChatGPT" page.
(function () {
  const button = document.querySelector('#gpt-copy');
  const url = document.querySelector('#gpt-url');
  if (!button || !url) return;
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url.textContent.trim()); button.textContent = 'Copied'; }
    catch (_) { const range = document.createRange(); range.selectNodeContents(url); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); button.textContent = 'Select and copy'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });
})();
