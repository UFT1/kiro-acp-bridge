const segments = location.pathname.split('/').filter(Boolean);
const isProjectPages = location.hostname.endsWith('.github.io') && segments[0] === 'kiro-acp-bridge';
const repository = isProjectPages
  ? `${location.hostname.split('.')[0]}/kiro-acp-bridge`
  : 'UFT1/kiro-acp-bridge';
const repositoryURL = `https://github.com/${repository}`;

for (const link of document.querySelectorAll('[data-repo-path]')) {
  const path = link.dataset.repoPath;
  link.href = `${repositoryURL}${path ? `${path.startsWith('#') ? '' : '/'}${path}` : ''}`;
}
document.querySelector('#clone-commands').textContent = `git clone ${repositoryURL}.git\ncd kiro-acp-bridge\nnpm test`;

if (navigator.clipboard?.writeText) {
  for (const button of document.querySelectorAll('.copy-button')) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      const code = button.closest('.code-block').querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied!';
        document.querySelector('#copy-status').textContent = 'Commands copied to clipboard.';
      } catch {
        button.textContent = 'Select text';
        document.querySelector('#copy-status').textContent = 'Clipboard unavailable. Select and copy the commands manually.';
      }
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    });
  }
}
