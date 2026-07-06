let builds = [];

function showBuildsSkeleton() {
  const list = document.getElementById('buildsList');
  if (!list) return;
  list.innerHTML = [1, 2, 3].map(() => `
    <div class="build-card" style="background:var(--surface);padding:24px;display:flex;gap:16px;flex-direction:column;">
      <div class="shimmer-block" style="height:14px;width:55%;"></div>
      <div class="shimmer-block" style="height:10px;width:35%;"></div>
      <div class="shimmer-block" style="height:4px;width:100%;margin-top:8px;"></div>
    </div>
  `).join('');
}

async function loadBuilds() {
  showBuildsSkeleton();

  const { data, error } = await supabase
    .from('builds')
    .select('*')
    .order('received', { ascending: false });

  if (error) {
    console.error('Failed to load builds:', error);
    const el = document.getElementById('boardUpdated');
    if (el) el.textContent = 'Error loading builds';
    return;
  }

  builds = data;
  renderBoardUpdated();
  renderSummary();
  renderBuilds();
}

loadBuilds();
