(() => {
  'use strict';

  const sourceLink = document.getElementById('topman-source-link');
  const sourceRevision = document.getElementById('topman-source-revision');
  if (!(sourceLink instanceof HTMLAnchorElement) || !sourceRevision) return;

  const repositoryUrl = 'https://github.com/Topman3579/topmanidmb-world-monitor';
  const applyRevision = (value) => {
    const hash = value.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(hash)) return;
    sourceLink.href = `${repositoryUrl}/commit/${hash}`;
    sourceRevision.textContent = `Topman3579/topmanidmb-world-monitor · ${hash.slice(0, 7)}`;
  };

  void fetch(`/build-hash.txt?t=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'text/plain' },
  })
    .then((response) => response.ok ? response.text() : Promise.reject(new Error('build hash unavailable')))
    .then(applyRevision)
    .catch(() => {
      // Keep the neutral repository link and pending-revision label.
    });
})();
