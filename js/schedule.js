(function ($, Drupal, drupalSettings, once) {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const CHILDREN = ['finnley', 'amelia'];
  const CHILD_LABELS = { finnley: 'Finnley', amelia: 'Amelia' };
  const CHILD_PAGE_TITLES = { finnley: 'Finnley School Schedule', amelia: 'Amelia School Schedule' };

  const AM_LABELS = { bus: 'Bus', dropoff: 'Dropoff', late_arrival: 'Late Arrival' };
  const PM_LABELS = { bus: 'Bus', pickup: 'Pickup', early_pickup: 'Early Pickup' };

  Drupal.behaviors.schoolSchedule = {
    attach: function (context) {
      once('scheduleProcessed', '#calendars-wrapper-finnley', context).forEach(function () {
        initScheduleApp();
      });
    }
  };

  const settings = drupalSettings.schoolSchedule || {};
  const EDITABLE = !!settings.editable;
  const CSRF_TOKEN = settings.csrfToken || '';

  let appData = { months: [], days: [] };
  let dayIndex = {};
  let rangeFilter = null;
  let rangeDefaultsApplied = false;

  async function initScheduleApp() {
    await loadData();
    wireRangeControls();
    if (EDITABLE) {
      wireModal();
      wireControlPanel();
      wireCopyControls();
    }
  }

  async function loadData() {
    try {
      const response = await fetch('/api/school-schedule');
      appData = await response.json();
      indexDays();
      populateRangeDefaults();
      renderApp();
    } catch (error) {
      console.error('Failed to load school schedule data:', error);
    }
  }

  function dayKey(child, ds) {
    return `${child}:${ds}`;
  }

  function indexDays() {
    dayIndex = {};
    (appData.days || []).forEach(d => { dayIndex[dayKey(d.child, d.day_date)] = d; });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dateStr(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function monthLabel(year, month) {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // -------- Display range filter --------

  function monthKey(year, month) {
    return year * 12 + month;
  }

  function isInRange(year, month) {
    if (!rangeFilter) return true;
    const key = monthKey(year, month);
    return key >= rangeFilter.startKey && key <= rangeFilter.endKey;
  }

  function sortedMonths() {
    return (appData.months || []).slice()
      .map(m => ({ year: Number(m.year), month: Number(m.month) }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
  }

  function populateRangeDefaults() {
    if (rangeDefaultsApplied) return;
    const months = sortedMonths();
    if (!months.length) return;

    const startMonthEl = document.getElementById('range-start-month');
    const startYearEl = document.getElementById('range-start-year');
    const endMonthEl = document.getElementById('range-end-month');
    const endYearEl = document.getElementById('range-end-year');
    if (!startMonthEl || !startYearEl || !endMonthEl || !endYearEl) return;

    const first = months[0];
    const last = months[months.length - 1];
    startMonthEl.value = String(first.month);
    startYearEl.value = String(first.year);
    endMonthEl.value = String(last.month);
    endYearEl.value = String(last.year);
    rangeDefaultsApplied = true;
  }

  function wireRangeControls() {
    const applyBtn = document.getElementById('range-apply-btn');
    const resetBtn = document.getElementById('range-reset-btn');

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const startYear = parseInt(document.getElementById('range-start-year').value, 10);
        const startMonth = parseInt(document.getElementById('range-start-month').value, 10);
        const endYear = parseInt(document.getElementById('range-end-year').value, 10);
        const endMonth = parseInt(document.getElementById('range-end-month').value, 10);

        if (!startYear || !startMonth || !endYear || !endMonth) return;

        const startKey = monthKey(startYear, startMonth);
        const endKey = monthKey(endYear, endMonth);
        if (startKey > endKey) {
          alert('The "From" month must be on or before the "To" month.');
          return;
        }

        rangeFilter = { startKey, endKey };
        renderApp();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        rangeFilter = null;
        renderApp();
      });
    }

    const exportBtn = document.getElementById('export-pdf-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        // The site theme/admin toolbar reserves layout space on an ancestor
        // of our content in a way that resists CSS and inline-style
        // overrides. Sidestep it entirely: relocate our content to be a
        // direct child of <body> for the print pass, then move it back.
        const wrapper = document.querySelector('.wrapper-container');
        if (!wrapper) {
          window.print();
          return;
        }

        const originalParent = wrapper.parentNode;
        const originalNextSibling = wrapper.nextSibling;
        document.body.appendChild(wrapper);

        const restore = () => {
          originalParent.insertBefore(wrapper, originalNextSibling);
          window.removeEventListener('afterprint', restore);
        };
        window.addEventListener('afterprint', restore);

        window.print();
      });
    }
  }

  // -------- Cell content --------

  function computeCell(entry) {
    if (!entry) {
      return { kind: 'blank' };
    }
    if (Number(entry.is_school_day) === 0) {
      const text = (entry.occasion_text || '').trim();
      return text ? { kind: 'solo', text } : { kind: 'blank' };
    }
    return {
      kind: 'transport',
      description: (entry.description || '').trim(),
      am: {
        text: `AM: ${AM_LABELS[entry.am_option] || entry.am_option}`,
        parent: entry.am_option === 'late_arrival' ? entry.late_arrival_parent : null,
      },
      pm: {
        text: `PM: ${PM_LABELS[entry.pm_option] || entry.pm_option}`,
        parent: entry.pm_option === 'early_pickup' ? entry.early_pickup_parent : null,
      },
      responsibleParent: entry.parent,
    };
  }

  // -------- Rendering --------

  function renderApp() {
    const months = sortedMonths();

    CHILDREN.forEach(child => {
      const wrapper = document.getElementById(`calendars-wrapper-${child}`);
      if (!wrapper) return;

      wrapper.innerHTML = '';
      let shownAny = false;

      months.forEach(({ year, month }) => {
        if (!isInRange(year, month)) return;
        shownAny = true;
        wrapper.appendChild(buildMonthCard(year, month, child));
      });

      if (!shownAny) {
        wrapper.innerHTML = '<p class="no-months-message">No months in the selected range.</p>';
      }
    });
  }

  function buildMonthCard(year, month, child) {
    const nDays = daysInMonth(year, month);
    const firstDayIndex = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

    const card = document.createElement('div');
    card.className = 'calendar-container';
    card.innerHTML = `
      <div class="print-page-title">${CHILD_PAGE_TITLES[child]}</div>
      <div class="header">
        <h2>${monthLabel(year, month)}</h2>
      </div>
      ${EDITABLE ? `<div class="month-actions"><button type="button" class="remove-month-btn">Remove Month</button></div>` : ''}
      <div class="grid">
        <div class="day-header">Sun</div><div class="day-header">Mon</div><div class="day-header">Tue</div>
        <div class="day-header">Wed</div><div class="day-header">Thu</div><div class="day-header">Fri</div><div class="day-header">Sat</div>
      </div>
    `;

    const grid = card.querySelector('.grid');
    for (let i = 0; i < firstDayIndex; i++) {
      const empty = document.createElement('div');
      empty.className = 'cell empty';
      grid.appendChild(empty);
    }
    for (let day = 1; day <= nDays; day++) {
      grid.appendChild(renderDayCell(year, month, day, child));
    }

    const removeBtn = card.querySelector('.remove-month-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => removeMonth(year, month));
    }

    return card;
  }

  function renderDayCell(year, month, day, child) {
    const cell = document.createElement('div');
    const ds = dateStr(year, month, day);
    const entry = dayIndex[dayKey(child, ds)];

    cell.className = 'cell';

    const dayNum = document.createElement('div');
    dayNum.className = 'day-number';
    dayNum.innerText = day;
    cell.appendChild(dayNum);

    const content = document.createElement('div');
    content.className = 'cell-content';

    const result = computeCell(entry);
    if (result.kind === 'solo') {
      const line = document.createElement('div');
      line.className = 'cell-solo';
      line.innerText = result.text;
      content.appendChild(line);
    } else if (result.kind === 'transport') {
      if (result.description) {
        const descLine = document.createElement('div');
        descLine.className = 'cell-description';
        descLine.innerText = result.description;
        content.appendChild(descLine);
      }
      [result.am, result.pm].forEach(info => {
        const line = document.createElement('div');
        line.className = 'cell-line';
        line.appendChild(document.createTextNode(info.text));
        if (info.parent) {
          const parentSpan = document.createElement('span');
          parentSpan.className = `parent-name parent-${info.parent}`;
          parentSpan.innerText = ` (${capitalize(info.parent)})`;
          line.appendChild(parentSpan);
        }
        content.appendChild(line);
      });
      if (result.responsibleParent) {
        const parentLine = document.createElement('div');
        parentLine.className = `cell-parent parent-${result.responsibleParent}`;
        parentLine.innerText = capitalize(result.responsibleParent);
        content.appendChild(parentLine);
      }
    }

    cell.appendChild(content);

    if (EDITABLE) {
      cell.classList.add('editable');
      cell.addEventListener('click', () => openModal(ds, child));
    }

    return cell;
  }

  // -------- Modal (click a day -> School Day / Not a School Day) --------

  function toggleDayTypeSections(dayType) {
    document.getElementById('school-section').style.display = dayType === 'school' ? 'block' : 'none';
    document.getElementById('non-school-section').style.display = dayType === 'non-school' ? 'block' : 'none';
  }

  function toggleParentFields() {
    const am = document.querySelector('input[name="am-option"]:checked')?.value;
    const pm = document.querySelector('input[name="pm-option"]:checked')?.value;
    document.getElementById('late-arrival-parent-field').style.display = am === 'late_arrival' ? 'block' : 'none';
    document.getElementById('early-pickup-parent-field').style.display = pm === 'early_pickup' ? 'block' : 'none';
  }

  function wireModal() {
    document.querySelectorAll('input[name="day-type"]').forEach(r => {
      r.addEventListener('change', (e) => toggleDayTypeSections(e.target.value));
    });
    document.querySelectorAll('input[name="am-option"]').forEach(r => {
      r.addEventListener('change', toggleParentFields);
    });
    document.querySelectorAll('input[name="pm-option"]').forEach(r => {
      r.addEventListener('change', toggleParentFields);
    });
  }

  window.openModal = function (dateString, child) {
    const modal = document.getElementById('modal');
    if (!modal) return;
    const entry = dayIndex[dayKey(child, dateString)];

    document.getElementById('modal-date-title').innerText = `Edit ${CHILD_LABELS[child]} - ${dateString}`;
    document.getElementById('modal-date-val').value = dateString;
    document.getElementById('modal-child-val').value = child;

    const dayType = (entry && Number(entry.is_school_day) === 0) ? 'non-school' : 'school';
    document.querySelectorAll('input[name="day-type"]').forEach(r => { r.checked = (r.value === dayType); });
    toggleDayTypeSections(dayType);

    document.querySelectorAll('input[name="am-option"]').forEach(r => {
      r.checked = (entry && entry.am_option) ? (r.value === entry.am_option) : (r.value === 'bus');
    });
    document.querySelectorAll('input[name="pm-option"]').forEach(r => {
      r.checked = (entry && entry.pm_option) ? (r.value === entry.pm_option) : (r.value === 'bus');
    });
    document.querySelectorAll('input[name="late-arrival-parent"]').forEach(r => {
      r.checked = (entry && entry.late_arrival_parent) ? (r.value === entry.late_arrival_parent) : (r.value === 'eric');
    });
    document.querySelectorAll('input[name="early-pickup-parent"]').forEach(r => {
      r.checked = (entry && entry.early_pickup_parent) ? (r.value === entry.early_pickup_parent) : (r.value === 'eric');
    });
    document.querySelectorAll('input[name="parent"]').forEach(r => {
      r.checked = (entry && entry.parent) ? (r.value === entry.parent) : (r.value === 'eric');
    });
    toggleParentFields();
    document.getElementById('modal-occasion').value = (entry && entry.occasion_text) || '';
    document.getElementById('modal-description').value = (entry && entry.description) || '';

    document.getElementById('modal-delete-btn').style.display = entry ? 'inline-block' : 'none';

    modal.style.display = 'flex';
  };

  window.closeModal = function () {
    const modal = document.getElementById('modal');
    if (modal) modal.style.display = 'none';
  };

  window.saveDay = async function () {
    const date = document.getElementById('modal-date-val').value;
    const child = document.getElementById('modal-child-val').value;
    const dayType = document.querySelector('input[name="day-type"]:checked')?.value;
    const isSchoolDay = dayType === 'school';
    const payload = { date, child, is_school_day: isSchoolDay };

    if (isSchoolDay) {
      payload.am_option = document.querySelector('input[name="am-option"]:checked')?.value;
      payload.pm_option = document.querySelector('input[name="pm-option"]:checked')?.value;
      payload.parent = document.querySelector('input[name="parent"]:checked')?.value;
      if (!payload.am_option || !payload.pm_option || !payload.parent) {
        alert('Please choose AM, PM, and the responsible parent.');
        return;
      }
      if (payload.am_option === 'late_arrival') {
        payload.late_arrival_parent = document.querySelector('input[name="late-arrival-parent"]:checked')?.value;
        if (!payload.late_arrival_parent) {
          alert('Please choose the Late Arrival Parent.');
          return;
        }
      }
      if (payload.pm_option === 'early_pickup') {
        payload.early_pickup_parent = document.querySelector('input[name="early-pickup-parent"]:checked')?.value;
        if (!payload.early_pickup_parent) {
          alert('Please choose the Early Pickup Parent.');
          return;
        }
      }
      payload.description = document.getElementById('modal-description').value.trim();
    } else {
      payload.occasion_text = document.getElementById('modal-occasion').value.trim();
    }

    try {
      const response = await postJson('/admin/config/school-schedule/day/save', payload);
      const result = await response.json();
      if (result.success) {
        closeModal();
        loadData();
      } else {
        alert(result.message || 'Failed to save.');
      }
    } catch (error) {
      console.error('Error saving day:', error);
    }
  };

  window.deleteDay = async function () {
    const date = document.getElementById('modal-date-val').value;
    const child = document.getElementById('modal-child-val').value;
    if (!confirm(`Clear ${CHILD_LABELS[child]}'s entry for ${date}?`)) return;

    try {
      await postJson('/admin/config/school-schedule/day/delete', { date, child });
      closeModal();
      loadData();
    } catch (error) {
      console.error('Error deleting day:', error);
    }
  };

  // -------- Month management --------

  async function addMonth(year, month) {
    try {
      const response = await postJson('/admin/config/school-schedule/month/add', { year, month });
      const result = await response.json();
      if (result.success) {
        loadData();
      } else {
        alert(result.message || 'Failed to add month.');
      }
    } catch (error) {
      console.error('Error adding month:', error);
    }
  }

  async function removeMonth(year, month) {
    if (!confirm(`Remove ${monthLabel(year, month)} and all of its day entries for both children?`)) return;
    try {
      await postJson('/admin/config/school-schedule/month/delete', { year, month });
      loadData();
    } catch (error) {
      console.error('Error removing month:', error);
    }
  }

  function wireControlPanel() {
    const addBtn = document.getElementById('add-month-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const year = parseInt(document.getElementById('add-month-year').value, 10);
        const month = parseInt(document.getElementById('add-month-select').value, 10);
        if (!year || !month) return;
        addMonth(year, month);
      });
    }
  }

  function wireCopyControls() {
    const copyBtn = document.getElementById('copy-month-btn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', async () => {
      const year = parseInt(document.getElementById('copy-month-year').value, 10);
      const month = parseInt(document.getElementById('copy-month-select').value, 10);
      const [from, to] = document.getElementById('copy-month-direction').value.split(':');
      if (!year || !month) return;

      if (!confirm(`Copy ${monthLabel(year, month)} from ${CHILD_LABELS[from]} to ${CHILD_LABELS[to]}? This will overwrite ${CHILD_LABELS[to]}'s existing entries for that month.`)) return;

      try {
        const response = await postJson('/admin/config/school-schedule/month/copy', { year, month, from, to });
        const result = await response.json();
        if (result.success) {
          loadData();
        } else {
          alert(result.message || 'Failed to copy month.');
        }
      } catch (error) {
        console.error('Error copying month:', error);
      }
    });
  }

  // -------- Export / Import / Clear --------

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
      body: JSON.stringify(body || {}),
    });
  }

  window.exportJson = function () {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appData, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', 'school_schedule_backup.json');
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  window.importJson = async function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        if (!imported.months || !imported.days) {
          alert('Invalid JSON format. Missing months or days arrays.');
          return;
        }
        const response = await postJson('/admin/config/school-schedule/import', imported);
        const result = await response.json();
        if (result.success) {
          alert('Schedule imported successfully.');
          loadData();
        } else {
          alert(result.message || 'Import failed.');
        }
      } catch (err) {
        console.error('Error parsing JSON file:', err);
        alert('Failed to parse the uploaded JSON file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  window.clearSchedule = async function () {
    if (!confirm('Delete the entire schedule (all months and days, both children)? This cannot be undone.')) return;
    try {
      const response = await postJson('/admin/config/school-schedule/clear', {});
      const result = await response.json();
      if (result.success) {
        appData = { months: [], days: [] };
        indexDays();
        renderApp();
      } else {
        alert('Failed to clear schedule.');
      }
    } catch (error) {
      console.error('Error clearing schedule:', error);
    }
  };

})(jQuery, Drupal, drupalSettings, once);
