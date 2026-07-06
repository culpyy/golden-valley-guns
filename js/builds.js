let builds = [];

async function loadBuilds() {
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
