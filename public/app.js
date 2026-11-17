document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const tabLinkBtn = document.getElementById('tabLinkBtn');
  const tabFileBtn = document.getElementById('tabFileBtn');
  const panelLink = document.getElementById('panelLink');
  const panelFile = document.getElementById('panelFile');

  const extractForm = document.getElementById('extractForm');
  const urlInput = document.getElementById('urlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const sampleBtn = document.getElementById('sampleBtn');
  const extractBtn = document.getElementById('extractBtn');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  const pipelineCard = document.getElementById('pipelineCard');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const step4 = document.getElementById('step4');

  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');

  const resultCard = document.getElementById('resultCard');
  const modelThumb = document.getElementById('modelThumb');
  const modelTitle = document.getElementById('modelTitle');
  const modelTaskId = document.getElementById('modelTaskId');
  const modelSize = document.getElementById('modelSize');
  const modelTime = document.getElementById('modelTime');
  const downloadLink = document.getElementById('downloadLink');
  const resetBtn = document.getElementById('resetBtn');

  const modelViewer = document.getElementById('modelViewer');
  const toggleRotateBtn = document.getElementById('toggleRotateBtn');
  const rotateBtnLabel = document.getElementById('rotateBtnLabel');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  let currentBlobUrl = null;

  // --- Tab Navigation ---
  tabLinkBtn.addEventListener('click', () => switchTab('link'));
  tabFileBtn.addEventListener('click', () => switchTab('file'));

  function switchTab(tab) {
    if (tab === 'link') {
      tabLinkBtn.classList.add('active');
      tabFileBtn.classList.remove('active');
      panelLink.classList.add('active');
      panelFile.classList.remove('active');
    } else {
      tabFileBtn.classList.add('active');
      tabLinkBtn.classList.remove('active');
      panelFile.classList.add('active');
      panelLink.classList.remove('active');
    }
    hideError();
  }

  // --- Paste from Clipboard ---
  if (pasteBtn && navigator.clipboard) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          urlInput.focus();
        }
      } catch {
        urlInput.focus();
      }
    });
  }

  // --- Sample Link Button ---
  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => {
      urlInput.value = 'https://www.meshy.ai/s/39mTE9';
      extractForm.dispatchEvent(new Event('submit'));
    });
  }

  // --- Form Submit: Link Extraction ---
  extractForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) return;

    hideError();
    resultCard.style.display = 'none';
    startPipeline();
    setExtractLoading(true);

    try {
      // Step 1: Resolve metadata
      setStepActive(step1);
      const extractResp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl })
      });

      const extractResult = await extractResp.json();
      if (!extractResp.ok || !extractResult.success) {
        throw new Error(extractResult.error || 'Failed to resolve share link.');
      }

      setStepDone(step1);
      const metadata = extractResult.data;

      // Step 2 & 3: Fetching and decrypting
      setStepActive(step2);
      await delay(200);
      setStepDone(step2);

      setStepActive(step3);
      const processResp = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelUrl: metadata.modelUrl,
          title: metadata.title,
          url: rawUrl
        })
      });

      const processResult = await processResp.json();
      if (!processResp.ok || !processResult.success) {
        throw new Error(processResult.error || 'Failed to decrypt 3D model.');
      }

      setStepDone(step3);

      // Step 4: Assembling GLB & Loading
      setStepActive(step4);
      await delay(200);
      setStepDone(step4);

      // Display Result
      displayResult({
        title: metadata.title,
        taskId: metadata.taskId,
        previewUrl: metadata.previewUrl,
        sizeFormatted: processResult.sizeFormatted,
        decryptionTimeSec: processResult.decryptionTimeSec,
        downloadUrl: processResult.downloadUrl,
        streamUrl: processResult.streamUrl
      });

    } catch (err) {
      console.error(err);
      showError(err.message || 'An error occurred while processing the 3D model.');
      pipelineCard.style.display = 'none';
    } finally {
      setExtractLoading(false);
    }
  });

  // --- Local File Dropzone Decryption ---
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleLocalFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleLocalFileUpload(e.target.files[0]);
    }
  });

  async function handleLocalFileUpload(file) {
    if (!file.name.toLowerCase().endsWith('.meshy')) {
      showError('Please upload a file with the .meshy extension.');
      return;
    }

    hideError();
    resultCard.style.display = 'none';
    startPipeline();
    setStepActive(step1);
    step1.querySelector('.step-desc').textContent = `Reading local file: ${file.name}...`;

    try {
      const formData = new FormData();
      formData.append('meshyFile', file);

      setStepDone(step1);
      setStepActive(step3);
      step3.querySelector('.step-desc').textContent = 'Decrypting file via WebAssembly engine...';

      const resp = await fetch('/api/upload-decrypt', {
        method: 'POST',
        body: formData
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to decrypt uploaded file.');
      }

      setStepDone(step3);
      setStepActive(step4);

      const blob = await resp.blob();
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
      currentBlobUrl = URL.createObjectURL(blob);

      setStepDone(step4);

      const baseName = file.name.replace(/\.meshy$/i, '');
      const glbName = `${baseName}.glb`;

      displayResult({
        title: baseName,
        taskId: 'Local Upload',
        previewUrl: null,
        sizeFormatted: (blob.size / (1024 * 1024)).toFixed(2) + ' MB',
        decryptionTimeSec: '< 0.5',
        downloadUrl: currentBlobUrl,
        downloadFilename: glbName,
        streamUrl: currentBlobUrl
      });

    } catch (err) {
      console.error(err);
      showError(err.message || 'Failed to decrypt local .meshy file.');
      pipelineCard.style.display = 'none';
    }
  }

  // --- Display Result Showcase ---
  function displayResult(data) {
    modelTitle.textContent = data.title || 'Meshy 3D Model';
    modelTaskId.textContent = data.taskId ? `Task ID: ${data.taskId}` : 'Task ID: Verified';
    modelSize.textContent = data.sizeFormatted || '-- MB';
    modelTime.textContent = (data.decryptionTimeSec ? `${data.decryptionTimeSec}s` : '0.2s');

    if (data.previewUrl) {
      modelThumb.src = data.previewUrl;
      modelThumb.style.display = 'block';
    } else {
      modelThumb.style.display = 'none';
    }

    // Set download link
    downloadLink.href = data.downloadUrl;
    if (data.downloadFilename) {
      downloadLink.setAttribute('download', data.downloadFilename);
    } else {
      downloadLink.removeAttribute('download');
    }

    // Load 3D Viewer
    if (data.streamUrl) {
      modelViewer.src = data.streamUrl;
      modelViewer.setAttribute('alt', data.title || 'Decrypted 3D Model');
    }

    pipelineCard.style.display = 'none';
    resultCard.style.display = 'block';

    // Smooth scroll to result card
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // --- Reset View ---
  resetBtn.addEventListener('click', () => {
    resultCard.style.display = 'none';
    pipelineCard.style.display = 'none';
    urlInput.value = '';
    urlInput.focus();
    modelViewer.src = '';
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  });

  // --- 3D Viewer Controls ---
  toggleRotateBtn.addEventListener('click', () => {
    if (modelViewer.autoRotate) {
      modelViewer.autoRotate = false;
      rotateBtnLabel.textContent = 'Auto-Spin';
    } else {
      modelViewer.autoRotate = true;
      rotateBtnLabel.textContent = 'Pause Spin';
    }
  });

  fullscreenBtn.addEventListener('click', () => {
    const viewerContainer = document.querySelector('.viewer-wrapper');
    if (!document.fullscreenElement) {
      viewerContainer.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  });

  // --- Pipeline Helpers ---
  function startPipeline() {
    pipelineCard.style.display = 'block';
    [step1, step2, step3, step4].forEach(s => {
      s.className = 'step-item';
      s.querySelector('.step-icon').textContent = s.id.replace('step', '');
    });
  }

  function setStepActive(stepEl) {
    stepEl.className = 'step-item active';
    stepEl.querySelector('.step-icon').innerHTML = '<div class="spinner"></div>';
  }

  function setStepDone(stepEl) {
    stepEl.className = 'step-item done';
    stepEl.querySelector('.step-icon').innerHTML = '✓';
  }

  function setExtractLoading(isLoading) {
    extractBtn.disabled = isLoading;
    if (isLoading) {
      extractBtn.querySelector('.btn-text').textContent = 'Decrypting...';
    } else {
      extractBtn.querySelector('.btn-text').textContent = 'Extract & Decrypt Model';
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.style.display = 'flex';
  }

  function hideError() {
    errorBanner.style.display = 'none';
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
});
