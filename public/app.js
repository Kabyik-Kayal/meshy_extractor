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
  const pipelinePhase = document.getElementById('pipelinePhase');
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

  // Canonical full URL sample (bypasses Cloudflare redirect challenges)
  const CANONICAL_SAMPLE_URL = 'https://www.meshy.ai/3d-models/Bullet-Rain-01a1e9b4-e914-77de-9458-b6625dea4cd6?utm_medium=referral-program&utm_source=meshy&utm_content=BBDLCQ&share_type=3d-models';

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

  // --- Sample Link Shortcut ---
  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => {
      urlInput.value = CANONICAL_SAMPLE_URL;
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
      setStepActive(step1, 'Resolving link & metadata...');
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
      setStepActive(step2, 'Downloading model container...');
      await delay(200);
      setStepDone(step2);

      setStepActive(step3, 'Decrypting with WebAssembly...');
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

      // Step 4: Finalize GLB
      setStepActive(step4, 'Reconstructing 3D model...');
      await delay(150);
      setStepDone(step4);
      pipelinePhase.textContent = 'Complete';

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
      showError(err.message || 'An error occurred during extraction.');
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
    setStepActive(step1, 'Reading file...');
    step1.querySelector('.log-desc').textContent = `Reading local file: ${file.name}...`;

    try {
      const formData = new FormData();
      formData.append('meshyFile', file);

      setStepDone(step1);
      setStepActive(step3, 'Decrypting file...');
      step3.querySelector('.log-desc').textContent = 'Executing WebAssembly decrypter engine...';

      const resp = await fetch('/api/upload-decrypt', {
        method: 'POST',
        body: formData
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to decrypt uploaded file.');
      }

      setStepDone(step3);
      setStepActive(step4, 'Reconstructing model...');

      const blob = await resp.blob();
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
      currentBlobUrl = URL.createObjectURL(blob);

      setStepDone(step4);
      pipelinePhase.textContent = 'Complete';

      const baseName = file.name.replace(/\.meshy$/i, '');
      const glbName = `${baseName}.glb`;

      displayResult({
        title: baseName,
        taskId: null,
        previewUrl: null,
        sizeFormatted: (blob.size / (1024 * 1024)).toFixed(2) + ' MB',
        decryptionTimeSec: '< 0.2',
        downloadUrl: currentBlobUrl,
        downloadFilename: glbName,
        streamUrl: currentBlobUrl
      });

    } catch (err) {
      console.error(err);
      showError(err.message || 'Failed to decrypt local container.');
      pipelineCard.style.display = 'none';
    }
  }

  // --- Display Result Showcase ---
  function displayResult(data) {
    modelTitle.textContent = data.title || 'Meshy 3D Model';
    modelTaskId.textContent = data.taskId ? `Task ID: ${data.taskId}` : '';
    modelSize.textContent = data.sizeFormatted || '-- MB';
    modelTime.textContent = (data.decryptionTimeSec ? `${data.decryptionTimeSec}s` : '0.18s');

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

    // Load 3D Viewport
    if (data.streamUrl) {
      modelViewer.src = data.streamUrl;
      modelViewer.setAttribute('alt', data.title || 'Decrypted 3D Asset');
    }

    pipelineCard.style.display = 'none';
    resultCard.style.display = 'block';

    // Smooth scroll to results
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

  // --- 3D Viewport Controls ---
  toggleRotateBtn.addEventListener('click', () => {
    if (modelViewer.autoRotate) {
      modelViewer.autoRotate = false;
      rotateBtnLabel.textContent = 'Auto-Rotate';
    } else {
      modelViewer.autoRotate = true;
      rotateBtnLabel.textContent = 'Pause Spin';
    }
  });

  fullscreenBtn.addEventListener('click', () => {
    const viewportContainer = document.querySelector('.cad-viewport-housing');
    if (!document.fullscreenElement) {
      viewportContainer.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  });

  // --- Pipeline Status Helpers ---
  function startPipeline() {
    pipelineCard.style.display = 'block';
    pipelinePhase.textContent = 'Starting...';
    [step1, step2, step3, step4].forEach(s => {
      s.className = 'log-entry';
      s.querySelector('.log-status-indicator').textContent = s.id.replace('step', '');
    });
  }

  function setStepActive(stepEl, phaseText) {
    stepEl.className = 'log-entry active';
    stepEl.querySelector('.log-status-indicator').innerHTML = '<div class="mini-spinner"></div>';
    if (phaseText) {
      pipelinePhase.textContent = phaseText;
    }
  }

  function setStepDone(stepEl) {
    stepEl.className = 'log-entry done';
    stepEl.querySelector('.log-status-indicator').innerHTML = '✓';
  }

  function setExtractLoading(isLoading) {
    extractBtn.disabled = isLoading;
    const btnText = extractBtn.querySelector('.btn-text');
    if (isLoading) {
      btnText.textContent = 'Extracting...';
    } else {
      btnText.textContent = 'Extract Model';
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
