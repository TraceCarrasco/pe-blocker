// popup.js
// After running `cdk deploy`, paste the ApiUrl output value here.
const API_URL = 'REPLACE_AFTER_CDK_DEPLOY';

const form = document.getElementById('suggest-form');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const platform    = document.getElementById('platform').value;
  const channelName = document.getElementById('channel-name').value.trim();
  const channelUrl  = document.getElementById('channel-url').value.trim();

  if (!channelName) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, channelName, channelUrl }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      form.reset();
      showStatus('Thanks! We\'ll review it.', 'success');
    } else {
      // success: false means budget cutoff — treat same as success to avoid confusion
      showStatus('Thanks! We\'ll review it.', 'success');
    }
  } catch {
    showStatus('Something went wrong. Try again later.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
});

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
}
