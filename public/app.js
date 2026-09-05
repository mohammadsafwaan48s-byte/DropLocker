/**
 * DropLocker - Client Application
 * Fast, reactive, zero-dependency cross-device client
 */

(() => {
  // State
  let passkey = localStorage.getItem('droplocker_passkey') || '';
  let activeFiles = [];
  let pollTimer = null;
  let isFetching = false;
  let currentPreviewFile = null;

  // DOM Elements
  const passkeyGate = document.getElementById('passkey-gate');
  const passkeyInput = document.getElementById('passkey-input');
  const passkeySubmitBtn = document.getElementById('passkey-submit-btn');
  const fileInput = document.getElementById('file-input');
  const selectFilesBtn = document.getElementById('select-files-btn');
  const dropPrompt = document.getElementById('drop-prompt');
  const fullscreenDropzone = document.getElementById('fullscreen-dropzone');
  const uploadDrawer = document.getElementById('upload-drawer');
  const filesGrid = document.getElementById('files-grid');
  const emptyState = document.getElementById('empty-state');
  const fileCount = document.getElementById('file-count');
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  const quickNoteInput = document.getElementById('quick-note-input');
  const sendNoteBtn = document.getElementById('send-note-btn');
  const manualRefreshBtn = document.getElementById('manual-refresh-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const toastContainer = document.getElementById('toast-container');

  // Modal Elements
  const previewModal = document.getElementById('preview-modal');
  const previewFilename = document.getElementById('preview-filename');
  const previewBody = document.getElementById('preview-body');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCopyBtn = document.getElementById('modal-copy-btn');
  const modalCopyText = document.getElementById('modal-copy-text');
  const modalDownloadLink = document.getElementById('modal-download-link');

  // Utilities
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatTimeAgo(isoString) {
    const date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  function getDownloadUrl(fileId, forceDownload = false) {
    const url = `/api/download/${fileId}`;
    const params = new URLSearchParams();
    if (passkey) params.set('key', passkey);
    if (forceDownload) params.set('download', '1');
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  function showToast(message, type = 'info', duration = 3200) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function setSyncStatus(state, label) {
    statusDot.className = `status-dot ${state}`;
    statusLabel.textContent = label;
  }

  // Cookie synchronization for native Android Share Target
  function syncPasskeyCookie(key) {
    if (!key) {
      document.cookie = 'passkey=; Path=/; Max-Age=0; SameSite=Strict';
    } else {
      document.cookie = `passkey=${encodeURIComponent(key)}; Path=/; Max-Age=31536000; SameSite=Strict; Secure`;
    }
  }

  // Auth Handlers
  async function checkAuth() {
    setSyncStatus('syncing', 'Authenticating');
    try {
      const res = await fetch('/api/auth-check', {
        headers: {
          'Authorization': `Bearer ${passkey}`,
          'X-Passkey': passkey,
        },
      });

      if (res.ok) {
        passkeyGate.classList.add('hidden');
        syncPasskeyCookie(passkey);
        setSyncStatus('', 'Ready');
        startPolling();
        fetchFiles();
      } else {
        showPasskeyModal();
      }
    } catch (err) {
      // Offline fallback: try to load anyway if we have passkey stored
      if (passkey) {
        passkeyGate.classList.add('hidden');
        fetchFiles();
      } else {
        showPasskeyModal();
      }
    }
  }

  function showPasskeyModal() {
    setSyncStatus('offline', 'Locked');
    passkeyGate.classList.remove('hidden');
    passkeyInput.value = '';
    passkeyInput.focus();
  }

  passkeySubmitBtn.addEventListener('click', async () => {
    const key = passkeyInput.value.trim();
    if (!key) return;
    passkey = key;
    localStorage.setItem('droplocker_passkey', passkey);
    syncPasskeyCookie(passkey);
    await checkAuth();
  });

  settingsBtn.addEventListener('click', () => {
    const action = confirm('Lock DropLocker and change your passkey?');
    if (action) {
      passkey = '';
      localStorage.removeItem('droplocker_passkey');
      syncPasskeyCookie('');
      showPasskeyModal();
    }
  });

  // Native Notification Helper
  function notifyUploadComplete(filename) {
    if (window.desktopAPI && window.desktopAPI.showNotification) {
      window.desktopAPI.showNotification('DropLocker Transfer Complete', `"${filename}" is now available across your devices.`);
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('DropLocker Transfer Complete', {
          body: `"${filename}" is now available across your devices.`,
          icon: '/icon.svg',
        });
      } catch (e) {}
    }
  }

  // File Type Helpers
  function getFileTypeCategory(mimeType, filename) {
    if (!mimeType) mimeType = '';
    const ext = filename.split('.').pop().toLowerCase();

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (
      mimeType.startsWith('text/') ||
      ['txt', 'md', 'json', 'csv', 'js', 'ts', 'html', 'css', 'py'].includes(ext)
    )
      return 'text';
    if (
      ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) ||
      mimeType.includes('compressed') ||
      mimeType.includes('zip')
    )
      return 'zip';
    if (
      ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext) ||
      mimeType.includes('word') ||
      mimeType.includes('presentation') ||
      mimeType.includes('sheet')
    )
      return 'doc';
    return 'other';
  }

  function renderTypeIcon(category) {
    const icons = {
      pdf: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-6 4h4"/></svg>`,
      doc: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
      zip: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>`,
      text: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16m-7 6h7"/></svg>`,
      audio: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>`,
      video: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`,
      other: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>`,
    };
    return icons[category] || icons.other;
  }

  // Upload Management
  function uploadFiles(files) {
    if (!files || files.length === 0) return;

    // Request notification permissions once on first upload if not asked yet
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    uploadDrawer.classList.add('has-items');

    Array.from(files).forEach((file) => {
      const uploadId = 'up-' + Math.random().toString(36).substr(2, 9);
      const card = document.createElement('div');
      card.className = 'upload-card';
      card.id = uploadId;
      card.innerHTML = `
        <div class="upload-header">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">${escapeHtml(file.name)}</span>
          <span id="${uploadId}-pct">0%</span>
        </div>
        <div class="upload-progress-bar-bg">
          <div class="upload-progress-bar-fill" id="${uploadId}-fill"></div>
        </div>
      `;
      uploadDrawer.prepend(card);

      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);
      xhr.setRequestHeader('Authorization', `Bearer ${passkey}`);
      xhr.setRequestHeader('X-Passkey', passkey);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          const pctEl = document.getElementById(`${uploadId}-pct`);
          const fillEl = document.getElementById(`${uploadId}-fill`);
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (fillEl) fillEl.style.width = `${pct}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          showToast(`Uploaded ${file.name}`, 'success');
          notifyUploadComplete(file.name);
          setTimeout(() => {
            card.remove();
            if (uploadDrawer.children.length === 0) {
              uploadDrawer.classList.remove('has-items');
            }
          }, 1200);
          fetchFiles();
        } else {
          showToast(`Upload failed for ${file.name}`, 'error');
          card.style.borderColor = 'var(--accent-rose)';
        }
      };

      xhr.onerror = () => {
        showToast(`Network error uploading ${file.name}`, 'error');
        card.style.borderColor = 'var(--accent-rose)';
      };

      xhr.send(formData);
    });
  }

  // Quick Note Sender
  async function sendQuickNote() {
    const text = quickNoteInput.value.trim();
    if (!text) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `Note-${timestamp}.txt`;
    const noteBlob = new File([text], filename, { type: 'text/plain;charset=utf-8' });

    quickNoteInput.value = '';
    uploadFiles([noteBlob]);
  }

  sendNoteBtn.addEventListener('click', sendQuickNote);
  quickNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendQuickNote();
    }
  });

  // Fetch & Render Files
  async function fetchFiles() {
    if (isFetching || !passkey) return;
    isFetching = true;
    setSyncStatus('syncing', 'Syncing');

    try {
      const res = await fetch('/api/files', {
        headers: {
          'Authorization': `Bearer ${passkey}`,
          'X-Passkey': passkey,
        },
      });

      if (res.status === 401) {
        showPasskeyModal();
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch files');

      const data = await res.json();
      const files = data.files || [];

      // Check if file list actually changed
      const currentSignature = activeFiles.map((f) => `${f.id}:${f.pinned}`).join('|');
      const newSignature = files.map((f) => `${f.id}:${f.pinned}`).join('|');

      if (currentSignature !== newSignature) {
        activeFiles = files;
        renderFiles(files);
      }

      fileCount.textContent = `${files.length} items`;
      setSyncStatus('', 'Ready');
    } catch (err) {
      setSyncStatus('offline', 'Offline');
    } finally {
      isFetching = false;
    }
  }

  function renderFiles(files) {
    if (files.length === 0) {
      emptyState.style.display = 'block';
      filesGrid.innerHTML = '';
      filesGrid.appendChild(emptyState);
      return;
    }

    emptyState.style.display = 'none';
    filesGrid.innerHTML = '';

    files.forEach((file) => {
      const category = getFileTypeCategory(file.mimeType, file.filename);
      const downloadUrl = getDownloadUrl(file.id);
      const directDownloadUrl = getDownloadUrl(file.id, true);

      const card = document.createElement('div');
      card.className = `file-card ${file.pinned ? 'pinned' : ''}`;
      card.id = `card-${file.id}`;

      // Media / Thumbnail markup
      let mediaMarkup = '';
      if (category === 'image') {
        mediaMarkup = `
          <div class="card-media" onclick="DropLocker.openPreview('${file.id}')">
            <img src="${downloadUrl}" alt="${escapeHtml(file.filename)}" loading="lazy" />
          </div>
        `;
      } else {
        mediaMarkup = `
          <div class="card-media" onclick="DropLocker.openPreview('${file.id}')">
            <div class="type-badge-icon type-${category}">
              ${renderTypeIcon(category)}
            </div>
          </div>
        `;
      }

      // Pin indicator
      const pinIndicator = file.pinned
        ? `<div class="card-pin-indicator">
             <svg fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v2.293l2.854 2.853a1 1 0 010 1.414L12.414 11H13a1 1 0 110 2h-2v4a1 1 0 11-2 0v-4H7a1 1 0 110-2h.586l-1.44-1.44a1 1 0 010-1.414L9 5.293V3a1 1 0 011-1z"/></svg>
             Pinned
           </div>`
        : '';

      card.innerHTML = `
        ${pinIndicator}
        ${mediaMarkup}
        <div class="card-body">
          <div class="card-title" title="${escapeHtml(file.filename)}" onclick="DropLocker.openPreview('${file.id}')">
            ${escapeHtml(file.filename)}
          </div>
          <div class="card-meta">
            <span>${formatBytes(file.size)}</span>
            <span>${formatTimeAgo(file.uploadedAt)}</span>
          </div>
          <div class="card-actions">
            <!-- Pin Button -->
            <button class="card-action-btn ${file.pinned ? 'pin-active' : ''}" 
                    title="${file.pinned ? 'Unpin (will auto-delete in 48h)' : 'Pin (keep forever)'}" 
                    onclick="DropLocker.togglePin('${file.id}', ${file.pinned})">
              <svg fill="${file.pinned ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>

            <!-- Copy to Clipboard Button -->
            <button class="card-action-btn" title="Copy to Clipboard" onclick="DropLocker.copyFileContent('${file.id}')">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            </button>

            <!-- Direct Download Link -->
            <a class="card-action-btn" title="Download" href="${directDownloadUrl}" download="${escapeHtml(file.filename)}">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>

            <!-- Delete Button -->
            <button class="card-action-btn delete-btn" title="Delete" onclick="DropLocker.deleteFile('${file.id}', '${escapeHtml(file.filename)}')">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      `;

      filesGrid.appendChild(card);
    });
  }

  // Global Actions Interface
  window.DropLocker = {
    async togglePin(fileId, currentPinned) {
      try {
        const res = await fetch(`/api/files/${fileId}/pin`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${passkey}`,
            'X-Passkey': passkey,
          },
          body: JSON.stringify({ pinned: !currentPinned }),
        });

        if (res.ok) {
          showToast(!currentPinned ? 'File pinned (protected from auto-cleanup)' : 'File unpinned', 'info');
          fetchFiles();
        }
      } catch (err) {
        showToast('Could not update pin status', 'error');
      }
    },

    async deleteFile(fileId, filename) {
      if (!confirm(`Delete "${filename}" from DropLocker?`)) return;

      const card = document.getElementById(`card-${fileId}`);
      if (card) {
        card.style.opacity = '0.3';
        card.style.transform = 'scale(0.95)';
      }

      try {
        const res = await fetch(`/api/files/${fileId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${passkey}`,
            'X-Passkey': passkey,
          },
        });

        if (res.ok) {
          showToast(`Deleted ${filename}`, 'info');
          if (card) card.remove();
          activeFiles = activeFiles.filter((f) => f.id !== fileId);
          fileCount.textContent = `${activeFiles.length} items`;
          if (activeFiles.length === 0) emptyState.style.display = 'block';
        } else {
          showToast('Failed to delete file', 'error');
          if (card) card.style.opacity = '1';
        }
      } catch (err) {
        showToast('Network error on delete', 'error');
        if (card) card.style.opacity = '1';
      }
    },

    async copyFileContent(fileId) {
      const file = activeFiles.find((f) => f.id === fileId);
      if (!file) return;

      const category = getFileTypeCategory(file.mimeType, file.filename);
      const downloadUrl = getDownloadUrl(fileId);

      try {
        // Image clipboard copy
        if (category === 'image' && 'ClipboardItem' in window) {
          showToast('Copying image to clipboard...', 'info', 1500);
          const resp = await fetch(downloadUrl);
          const blob = await resp.blob();

          // Canvas conversion to PNG if browser requires PNG on clipboard
          if (blob.type === 'image/png') {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('Image copied to clipboard!', 'success');
            return;
          } else {
            // Convert to PNG via bitmap
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = URL.createObjectURL(blob);
            await new Promise((resolve) => (img.onload = resolve));

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            canvas.toBlob(async (pngBlob) => {
              if (pngBlob) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                showToast('Image copied to clipboard!', 'success');
              }
            }, 'image/png');
            return;
          }
        }

        // Text files copy
        if (category === 'text') {
          showToast('Copying text snippet...', 'info', 1200);
          const resp = await fetch(downloadUrl);
          const text = await resp.text();
          await navigator.clipboard.writeText(text);
          showToast('Snippet copied to clipboard!', 'success');
          return;
        }

        // Fallback: Copy direct shareable URL
        const fullUrl = `${window.location.origin}${downloadUrl}`;
        await navigator.clipboard.writeText(fullUrl);
        showToast('Link copied to clipboard!', 'success');
      } catch (err) {
        console.error('Copy failed:', err);
        showToast('Could not copy directly to clipboard', 'error');
      }
    },

    async openPreview(fileId) {
      const file = activeFiles.find((f) => f.id === fileId);
      if (!file) return;

      currentPreviewFile = file;
      previewFilename.textContent = file.filename;
      modalDownloadLink.href = getDownloadUrl(file.id, true);
      modalDownloadLink.setAttribute('download', file.filename);

      const category = getFileTypeCategory(file.mimeType, file.filename);
      const downloadUrl = getDownloadUrl(file.id);

      previewBody.innerHTML = '<div style="padding: 2rem; color: var(--text-dim);">Loading preview...</div>';
      previewModal.classList.add('active');

      if (category === 'image') {
        modalCopyText.textContent = 'Copy Image';
        previewBody.innerHTML = `<img src="${downloadUrl}" class="modal-media-view" alt="${escapeHtml(file.filename)}" />`;
      } else if (category === 'video') {
        modalCopyText.textContent = 'Copy Link';
        previewBody.innerHTML = `<video controls autoplay class="modal-media-view" src="${downloadUrl}"></video>`;
      } else if (category === 'audio') {
        modalCopyText.textContent = 'Copy Link';
        previewBody.innerHTML = `<audio controls autoplay style="width: 100%; margin: 2rem 0;" src="${downloadUrl}"></audio>`;
      } else if (category === 'text') {
        modalCopyText.textContent = 'Copy Text';
        try {
          const resp = await fetch(downloadUrl);
          const text = await resp.text();
          previewBody.innerHTML = `<pre class="modal-text-view">${escapeHtml(text)}</pre>`;
        } catch (e) {
          previewBody.innerHTML = '<p style="color: var(--accent-rose);">Failed to load text preview</p>';
        }
      } else {
        modalCopyText.textContent = 'Copy Link';
        previewBody.innerHTML = `
          <div style="text-align: center; padding: 2rem;">
            <div class="type-badge-icon type-${category}" style="margin: 0 auto 1.5rem; width: 64px; height: 64px;">
              ${renderTypeIcon(category)}
            </div>
            <p style="font-weight: 600; margin-bottom: 0.5rem;">${escapeHtml(file.filename)}</p>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">${formatBytes(file.size)} • ${file.mimeType}</p>
            <a href="${downloadUrl}&download=1" class="btn btn-primary" download="${escapeHtml(file.filename)}">Download File</a>
          </div>
        `;
      }
    },
  };

  // Modal Close Handlers
  function closeModal() {
    previewModal.classList.remove('active');
    previewBody.innerHTML = '';
    currentPreviewFile = null;
  }

  modalCloseBtn.addEventListener('click', closeModal);
  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && previewModal.classList.contains('active')) {
      closeModal();
    }
  });

  modalCopyBtn.addEventListener('click', () => {
    if (currentPreviewFile) {
      DropLocker.copyFileContent(currentPreviewFile.id);
    }
  });

  // Global Drag and Drop
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer.types.includes('Files')) {
      fullscreenDropzone.classList.add('active');
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      fullscreenDropzone.classList.remove('active');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    fullscreenDropzone.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // File Picker bindings
  selectFilesBtn.addEventListener('click', () => fileInput.click());
  dropPrompt.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      fileInput.value = '';
    }
  });

  // Global Clipboard Paste Listener (Ctrl+V / Cmd+V)
  window.addEventListener('paste', (e) => {
    // If the user is actively typing in an input field, let normal paste happen
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      return;
    }

    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const filesToUpload = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // 1. Image or File from clipboard
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const ext = file.type.split('/')[1] || 'png';
          const namedFile = new File([file], `Pasted-${timestamp}.${ext}`, { type: file.type });
          filesToUpload.push(namedFile);
        }
      }
      // 2. Plain text / snippet copied
      else if (item.kind === 'string' && item.type === 'text/plain') {
        item.getAsString((text) => {
          if (text && text.trim().length > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const textFile = new File([text], `Pasted-Snippet-${timestamp}.txt`, {
              type: 'text/plain;charset=utf-8',
            });
            uploadFiles([textFile]);
          }
        });
      }
    }

    if (filesToUpload.length > 0) {
      uploadFiles(filesToUpload);
    }
  });

  // Smart Polling Lifecycle
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchFiles();
      }
    }, 5000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchFiles();
    }
  });

  manualRefreshBtn.addEventListener('click', () => {
    fetchFiles();
  });

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Handle URL Query Params from Android Share Target
  function handleUrlParams() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('shared') === '1') {
      showToast('New asset received from Android Share!', 'success', 4000);
      url.searchParams.delete('shared');
      window.history.replaceState({}, '', url.pathname);
    }
    if (url.searchParams.get('error')) {
      showToast(decodeURIComponent(url.searchParams.get('error')), 'error', 5000);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.pathname);
    }
  }

  // Service Worker Registration
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
      });
    }
  }

  // Desktop App Integration (Electron)
  if (window.desktopAPI && window.desktopAPI.onNativeClipboardUpload) {
    window.desktopAPI.onNativeClipboardUpload((payload) => {
      if (payload.type === 'image' && payload.data) {
        const byteCharacters = atob(payload.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: payload.mimeType || 'image/png' });
        const file = new File([blob], payload.filename || `Pasted-${Date.now()}.png`, { type: payload.mimeType || 'image/png' });
        uploadFiles([file]);
      } else if (payload.type === 'text' && payload.text) {
        const file = new File([payload.text], payload.filename || `Snippet-${Date.now()}.txt`, { type: 'text/plain;charset=utf-8' });
        uploadFiles([file]);
      }
    });
  }

  // Initial Boot
  handleUrlParams();
  registerServiceWorker();
  checkAuth();
})();
