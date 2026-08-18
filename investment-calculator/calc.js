// Property Investment Calculator
// All estimates are computed client-side from typical expense ratios and
// national/Michigan tax-rate approximations — there is no live rate feed,
// geocoding, or tax-record lookup here. Every automated number is clearly
// labeled "estimate" and is editable by the user in the breakdown. See
// /investment-calculator/methodology/ for the full explanation.

(function () {
  const TYPE_DEFAULTS = {
    multifamily: { label: 'Duplex / Small Multifamily', vacancy: 5, opex: 30 },
    office: { label: 'Office Building', vacancy: 10, opex: 20 },
    retail: { label: 'Retail / Mixed-Use Storefront', vacancy: 8, opex: 20 },
    other: { label: 'Other Investment Property', vacancy: 7, opex: 25 },
  };

  const state = {
    step: 0,
    propertyType: null,
    address: '',
    stateCode: '',
    units: [{ label: 'Unit 1', rent: null }],
    hasAskingPrice: null,
    askingPrice: null,
    targetCapRate: 7,
    showFinancing: false,
    financing: { downPct: 25, rate: 7.25, termYears: 25, closingPct: 2.5, targetCoC: 8 },
    overrides: {},
    resultsTracked: false,
  };

  const els = {};

  function fmtMoney(n, cents) {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
  }

  function fmtPct(n) {
    return `${n.toFixed(2)}%`;
  }

  function typeDefaults() {
    return TYPE_DEFAULTS[state.propertyType] || TYPE_DEFAULTS.other;
  }

  // ---------- Core math ----------
  // Every rent/lease line the user enters is monthly; GPI is the annualized
  // total at full occupancy. EGI backs out vacancy loss. "EGI net" backs out
  // management/maintenance/misc operating expenses (as a % of EGI, varies by
  // property type) but NOT property tax or insurance — those are modeled
  // separately as a % of price so the reverse "what should I pay" math stays
  // a clean, direct calculation instead of a guess-and-check loop.

  function grossPotentialIncomeAnnual() {
    return state.units.reduce((sum, u) => sum + (u.rent || 0), 0) * 12;
  }

  function vacancyPct() {
    return state.overrides.vacancyPct != null ? state.overrides.vacancyPct : typeDefaults().vacancy;
  }

  function opExPct() {
    return state.overrides.opExPct != null ? state.overrides.opExPct : typeDefaults().opex;
  }

  function taxRatePct() {
    if (state.overrides.taxRatePct != null) return state.overrides.taxRatePct;
    if (state.stateCode !== 'MI') return 1.1; // national average effective rate
    // Investment property never qualifies for Michigan's Principal Residence
    // Exemption, so it's always taxed at the non-homestead millage — see the
    // mortgage calculator's methodology page for the same model in more detail.
    const taxableValueRatio = 0.5;
    const millage = 50;
    return taxableValueRatio * (millage / 10); // 2.5%
  }

  function insuranceRatePct() {
    return state.overrides.insuranceRatePct != null ? state.overrides.insuranceRatePct : 0.5;
  }

  function carryRatePct() {
    // Property tax + insurance, combined, as a % of price — the part of
    // operating cost that scales with what's actually paid for the property.
    return taxRatePct() + insuranceRatePct();
  }

  function egiAnnual() {
    return grossPotentialIncomeAnnual() * (1 - vacancyPct() / 100);
  }

  function egiNetAnnual() {
    return egiAnnual() * (1 - opExPct() / 100);
  }

  function mortgageConstantAnnual(ratePct, termYears) {
    const r = ratePct / 100 / 12;
    const n = termYears * 12;
    if (n <= 0) return 0;
    const monthlyFactor = r === 0 ? 1 / n : (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return monthlyFactor * 12;
  }

  function suggestedPriceForCapRate(targetPct) {
    const net = egiNetAnnual();
    const target = targetPct / 100;
    const cr = carryRatePct() / 100;
    const denom = target + cr;
    if (denom <= 0) return null;
    return net / denom;
  }

  function suggestedPriceForCashOnCash(targetPct) {
    const net = egiNetAnnual();
    const target = targetPct / 100;
    const cr = carryRatePct() / 100;
    const f = state.financing;
    const k = mortgageConstantAnnual(f.rate, f.termYears);
    const downFrac = f.downPct / 100;
    const closingFrac = f.closingPct / 100;
    const denom = target * (downFrac + closingFrac) + cr + (1 - downFrac) * k;
    if (denom <= 0) return null;
    return net / denom;
  }

  function analyzeAtPrice(price) {
    const net = egiNetAnnual();
    const cr = carryRatePct() / 100;
    const noi = net - price * cr;
    const capRate = price > 0 ? noi / price : 0;

    const f = state.financing;
    const k = mortgageConstantAnnual(f.rate, f.termYears);
    const loanAmount = price * (1 - f.downPct / 100);
    const annualDebtService = loanAmount * k;
    const cashFlow = noi - annualDebtService;
    const cashInvested = price * (f.downPct / 100 + f.closingPct / 100);
    const coc = cashInvested > 0 ? cashFlow / cashInvested : 0;
    const dscr = annualDebtService > 0 ? noi / annualDebtService : null;

    return { price, noi, capRate, loanAmount, annualDebtService, cashFlow, cashInvested, coc, dscr };
  }

  // ---------- Step definitions ----------
  const STEPS = ['type', 'address', 'units', 'vacancy', 'target', 'results'];

  function renderProgress() {
    const total = STEPS.length - 1;
    let html = '';
    for (let i = 0; i < total; i++) {
      const cls = i < state.step ? 'done' : i === state.step ? 'current' : '';
      html += `<div class="calc-progress-dot ${cls}"></div>`;
    }
    els.progress.innerHTML = html;
    els.progress.style.display = state.step >= total ? 'none' : 'flex';
  }

  function goTo(step) {
    state.step = step;
    render();
    els.widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function next() { if (state.step < STEPS.length - 1) goTo(state.step + 1); }
  function back() { if (state.step > 0) goTo(state.step - 1); }

  function optionButton(label, sub, selected, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calc-option-btn' + (selected ? ' selected' : '');
    btn.innerHTML = `${label}${sub ? `<span class="calc-option-sub">${sub}</span>` : ''}`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function navRow(canNext, onNext, nextLabel) {
    const row = document.createElement('div');
    row.className = 'calc-nav';
    if (state.step > 0) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'calc-btn calc-btn-back';
      b.textContent = '← Back';
      b.addEventListener('click', back);
      row.appendChild(b);
    } else {
      row.appendChild(document.createElement('span'));
    }
    const n = document.createElement('button');
    n.type = 'button';
    n.className = 'calc-btn calc-btn-primary';
    n.textContent = nextLabel || 'Next';
    n.disabled = !canNext;
    n.addEventListener('click', onNext);
    row.appendChild(n);
    return row;
  }

  function renderStepType() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 1 of 5';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'What kind of property is it?';

    const opts = document.createElement('div');
    opts.className = 'calc-options calc-options-wide';
    Object.entries(TYPE_DEFAULTS).forEach(([val, def]) => {
      opts.appendChild(optionButton(def.label, '', state.propertyType === val, () => {
        state.propertyType = val;
        renderStepType();
      }));
    });

    els.body.append(eyebrow, q, opts);
    const nav = navRow(!!state.propertyType, next);
    els.body.appendChild(nav);
  }

  function renderStepAddress() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 2 of 5';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'Where is the property?';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'calc-input';
    input.placeholder = 'Street address, city (for your own reference)';
    input.value = state.address;
    input.addEventListener('input', () => { state.address = input.value; });

    const stateLabel = document.createElement('div');
    stateLabel.className = 'calc-hint';
    stateLabel.style.marginTop = '16px';
    stateLabel.textContent = 'State (used to estimate property taxes):';

    const select = document.createElement('select');
    select.className = 'calc-input';
    select.style.marginTop = '8px';
    const stateOptions = [
      ['', 'Select a state'], ['MI', 'Michigan'], ['OTHER', 'Other / not sure'],
    ];
    stateOptions.forEach(([val, label]) => {
      const o = document.createElement('option');
      o.value = val; o.textContent = label;
      if (state.stateCode === val) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => { state.stateCode = select.value; });

    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.textContent = "We don't pull the actual tax bill for a specific address — we estimate a rate based on the state, and you can always type in the real number once you have it.";

    els.body.append(eyebrow, q, input, stateLabel, select, hint);
    const nav = navRow(true, next);
    els.body.appendChild(nav);
  }

  function renderStepUnits() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 3 of 5';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'What rent or lease income can you expect?';
    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.style.marginBottom = '14px';
    hint.textContent = 'Add a line for each unit or leased space, with its expected monthly rent.';

    els.body.append(eyebrow, q, hint);

    const list = document.createElement('div');
    state.units.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'calc-unit-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'calc-input';
      labelInput.placeholder = `Unit ${i + 1}`;
      labelInput.value = u.label;
      labelInput.addEventListener('input', () => { u.label = labelInput.value; });

      const rentInput = document.createElement('input');
      rentInput.type = 'number';
      rentInput.className = 'calc-input';
      rentInput.inputMode = 'numeric';
      rentInput.placeholder = 'Monthly rent $';
      rentInput.value = u.rent || '';
      rentInput.addEventListener('input', () => {
        u.rent = parseFloat(rentInput.value) || null;
        updateTotal();
        nav.querySelector('.calc-btn-primary').disabled = !canGo();
      });

      row.append(labelInput, rentInput);

      if (state.units.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'calc-unit-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', () => {
          state.units.splice(i, 1);
          renderStepUnits();
        });
        row.appendChild(removeBtn);
      }

      list.appendChild(row);
    });
    els.body.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'calc-add-unit';
    addBtn.textContent = '+ Add another unit / space';
    addBtn.addEventListener('click', () => {
      state.units.push({ label: `Unit ${state.units.length + 1}`, rent: null });
      renderStepUnits();
    });
    els.body.appendChild(addBtn);

    const total = document.createElement('div');
    total.className = 'calc-unit-total';
    els.body.appendChild(total);

    function updateTotal() {
      const monthly = state.units.reduce((sum, u) => sum + (u.rent || 0), 0);
      total.textContent = `Total: ${fmtMoney(monthly)}/mo (${fmtMoney(monthly * 12)}/yr before vacancy)`;
    }
    updateTotal();

    function canGo() {
      return state.units.some((u) => u.rent);
    }

    const nav = navRow(canGo(), next);
    els.body.appendChild(nav);
  }

  function renderStepVacancy() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 4 of 5';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'How much vacancy should we plan for?';
    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.style.marginBottom = '14px';
    hint.textContent = `A typical starting point for a ${typeDefaults().label.toLowerCase()} is ${typeDefaults().vacancy}% — you can fine-tune this and other assumptions in the results.`;

    const opts = document.createElement('div');
    opts.className = 'calc-options';
    [0, 3, 5, 8, 10, 15].forEach((pct) => {
      opts.appendChild(optionButton(`${pct}%`, '', vacancyPct() === pct, () => {
        state.overrides.vacancyPct = pct;
        renderStepVacancy();
      }));
    });

    els.body.append(eyebrow, q, hint, opts);
    const nav = navRow(true, next);
    els.body.appendChild(nav);
  }

  function renderStepTarget() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 5 of 5';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'What return are you targeting?';
    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.style.marginBottom = '14px';
    hint.textContent = "This is the cap rate (return before financing) you'd want to hit — 7% is a reasonable starting point, but it varies a lot by market and property condition. You can change this anytime on the results screen.";

    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.className = 'calc-input-large';
    rateInput.step = '0.25';
    rateInput.value = state.targetCapRate;
    rateInput.addEventListener('input', () => {
      state.targetCapRate = parseFloat(rateInput.value) || 0;
    });

    const askLabel = document.createElement('div');
    askLabel.className = 'calc-hint';
    askLabel.style.marginTop = '20px';
    askLabel.textContent = 'Do you have an asking price to check?';

    const opts = document.createElement('div');
    opts.className = 'calc-options';
    [['no', 'Not yet'], ['yes', 'Yes']].forEach(([val, label]) => {
      opts.appendChild(optionButton(label, '', state.hasAskingPrice === val, () => {
        state.hasAskingPrice = val;
        renderStepTarget();
      }));
    });

    els.body.append(eyebrow, q, hint, rateInput, askLabel, opts);

    if (state.hasAskingPrice === 'yes') {
      const priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.className = 'calc-input';
      priceInput.style.marginTop = '14px';
      priceInput.inputMode = 'numeric';
      priceInput.placeholder = 'Asking price $';
      priceInput.value = state.askingPrice || '';
      priceInput.addEventListener('input', () => { state.askingPrice = parseFloat(priceInput.value) || null; });
      els.body.appendChild(priceInput);
    }

    const nav = navRow(!!state.targetCapRate, () => { goTo(STEPS.length - 1); }, 'See my estimate');
    els.body.appendChild(nav);
  }

  function editableRow(label, value, key, isMoney, isPercent, onChange) {
    const tr = document.createElement('tr');
    tr.className = 'calc-editable';
    const td1 = document.createElement('td');
    td1.innerHTML = `${label}<span class="calc-estimate-tag">Estimate</span>`;
    const td2 = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'calc-edit-input';
    input.step = isPercent ? '0.05' : '1';
    input.value = isPercent ? value.toFixed(2) : Math.round(value);
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) state.overrides[key] = v;
      (onChange || renderResults)();
    });
    td2.appendChild(input);
    tr.append(td1, td2);
    return tr;
  }

  function staticRow(label, value, isSubtotal) {
    const tr = document.createElement('tr');
    if (isSubtotal) tr.className = 'calc-subtotal';
    const td1 = document.createElement('td');
    td1.textContent = label;
    const td2 = document.createElement('td');
    td2.textContent = value;
    tr.append(td1, td2);
    return tr;
  }

  function renderResults() {
    els.body.innerHTML = '';

    const suggestedPrice = suggestedPriceForCapRate(state.targetCapRate);
    const hasAsking = state.hasAskingPrice === 'yes' && state.askingPrice;
    const askingAnalysis = hasAsking ? analyzeAtPrice(state.askingPrice) : null;

    if (!state.resultsTracked) {
      state.resultsTracked = true;
      if (typeof gtag === 'function') {
        gtag('event', 'investment_calculator_result_viewed', {
          property_type: state.propertyType || undefined,
          state_code: state.stateCode || undefined,
          had_asking_price: hasAsking,
        });
      }
    }

    const head = document.createElement('div');
    head.className = 'calc-results-head';
    head.innerHTML = `<div class="calc-eyebrow">Your estimate</div><p>Based on ${fmtMoney(grossPotentialIncomeAnnual())}/yr in gross rent for this ${typeDefaults().label.toLowerCase()} — not an appraisal or a lender's underwriting.</p>`;

    const card1 = document.createElement('div');
    card1.className = 'calc-result-card calc-result-primary';
    card1.innerHTML = `
      <div class="calc-result-label">Suggested price for a ${fmtPct(state.targetCapRate)} return</div>
      <div class="calc-result-value">${suggestedPrice != null ? fmtMoney(Math.round(suggestedPrice)) : '—'}</div>
      <div class="calc-result-includes">The most you'd want to pay for this income to hit your target return, after estimated vacancy, operating expenses, property tax, and insurance — before financing.</div>
    `;

    els.body.append(head, card1);

    if (askingAnalysis) {
      const card2 = document.createElement('div');
      card2.className = 'calc-result-card';
      card2.innerHTML = `
        <div class="calc-result-label">At the asking price of ${fmtMoney(state.askingPrice)}</div>
        <div class="calc-result-value">${fmtPct(askingAnalysis.capRate * 100)}<span style="font-size:15px;font-weight:600;"> cap rate</span></div>
        <div class="calc-result-includes">Estimated net operating income of ${fmtMoney(Math.round(askingAnalysis.noi))}/yr at that price.</div>
      `;
      els.body.appendChild(card2);
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'calc-breakdown-toggle';
    toggle.textContent = 'Show the complete breakdown';

    const table = document.createElement('table');
    table.className = 'calc-breakdown-table';
    table.style.display = 'none';
    table.appendChild(staticRow('Gross potential income (annual)', fmtMoney(grossPotentialIncomeAnnual())));
    table.appendChild(editableRow('Vacancy & credit loss', vacancyPct(), 'vacancyPct', false, true));
    table.appendChild(staticRow('Effective gross income', fmtMoney(Math.round(egiAnnual()))));
    table.appendChild(editableRow('Operating expenses (% of EGI — mgmt, maintenance, misc.)', opExPct(), 'opExPct', false, true));
    table.appendChild(editableRow('Property tax rate (% of price)', taxRatePct(), 'taxRatePct', false, true));
    table.appendChild(editableRow('Insurance rate (% of price)', insuranceRatePct(), 'insuranceRatePct', false, true));
    if (askingAnalysis) {
      table.appendChild(staticRow(`Net operating income at ${fmtMoney(state.askingPrice)}`, fmtMoney(Math.round(askingAnalysis.noi)), true));
    }

    toggle.addEventListener('click', () => {
      const open = table.style.display !== 'none';
      table.style.display = open ? 'none' : 'table';
      toggle.textContent = open ? 'Show the complete breakdown' : 'Hide the complete breakdown';
    });

    els.body.append(toggle, table);

    // Financing / cash-on-cash section — optional, since it needs assumptions
    // beyond the property itself.
    const financeToggle = document.createElement('button');
    financeToggle.type = 'button';
    financeToggle.className = 'calc-breakdown-toggle';
    financeToggle.textContent = state.showFinancing ? 'Hide financed return (cash-on-cash)' : 'Also see the return if you finance it';
    financeToggle.addEventListener('click', () => {
      state.showFinancing = !state.showFinancing;
      renderResults();
    });
    els.body.appendChild(financeToggle);

    if (state.showFinancing) {
      const panel = document.createElement('div');
      panel.className = 'calc-financing-panel';

      function financeField(label, key, step, suffix) {
        const wrap = document.createElement('div');
        const lbl = document.createElement('label');
        lbl.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'calc-input';
        input.step = step;
        input.value = state.financing[key];
        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (!isNaN(v)) state.financing[key] = v;
          renderResults();
        });
        wrap.append(lbl, input);
        return wrap;
      }

      const row1 = document.createElement('div');
      row1.className = 'calc-field-row';
      row1.append(financeField('Down payment (%)', 'downPct', '1'), financeField('Closing costs (%)', 'closingPct', '0.5'));
      const row2 = document.createElement('div');
      row2.className = 'calc-field-row';
      row2.append(financeField('Interest rate (%)', 'rate', '0.125'), financeField('Loan term (years)', 'termYears', '1'));
      panel.append(row1, row2);

      const priceForCoC = suggestedPriceForCashOnCash(state.financing.targetCoC);
      const cocCard = document.createElement('div');
      cocCard.className = 'calc-stat-grid';
      cocCard.style.gridTemplateColumns = '1fr 1fr';
      cocCard.innerHTML = `
        <div class="calc-stat-box">
          <div class="calc-stat-label">Price for ${fmtPct(state.financing.targetCoC)} cash-on-cash</div>
          <div class="calc-stat-value">${priceForCoC != null ? fmtMoney(Math.round(priceForCoC)) : '—'}</div>
        </div>
        <div class="calc-stat-box">
          <div class="calc-stat-label">Target cash-on-cash</div>
          <div class="calc-stat-value">${fmtPct(state.financing.targetCoC)}</div>
        </div>
      `;
      panel.appendChild(cocCard);

      if (askingAnalysis) {
        const stats = document.createElement('div');
        stats.className = 'calc-stat-grid';
        stats.innerHTML = `
          <div class="calc-stat-box">
            <div class="calc-stat-label">Cash-on-cash at asking</div>
            <div class="calc-stat-value">${fmtPct(askingAnalysis.coc * 100)}</div>
          </div>
          <div class="calc-stat-box">
            <div class="calc-stat-label">Annual cash flow</div>
            <div class="calc-stat-value">${fmtMoney(Math.round(askingAnalysis.cashFlow))}</div>
          </div>
          <div class="calc-stat-box">
            <div class="calc-stat-label">DSCR</div>
            <div class="calc-stat-value">${askingAnalysis.dscr != null ? askingAnalysis.dscr.toFixed(2) : '—'}</div>
          </div>
        `;
        panel.appendChild(stats);
      }

      const financeHint = document.createElement('div');
      financeHint.className = 'calc-hint';
      financeHint.style.marginTop = '10px';
      financeHint.textContent = 'Cash-on-cash return is your annual cash flow after the mortgage payment, divided by the cash you actually put in (down payment + closing costs). DSCR is net operating income divided by the annual mortgage payment — most lenders want this at 1.20 or higher.';
      panel.appendChild(financeHint);

      els.body.appendChild(panel);
    }

    const actions = document.createElement('div');
    actions.className = 'calc-actions';
    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'calc-btn';
    printBtn.textContent = 'Print / Save PDF';
    printBtn.addEventListener('click', () => window.print());
    actions.appendChild(printBtn);

    const restart = document.createElement('div');
    restart.className = 'calc-restart';
    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.textContent = 'Start a new estimate';
    restartBtn.addEventListener('click', () => {
      Object.assign(state, {
        step: 0, propertyType: null, address: '', stateCode: '',
        units: [{ label: 'Unit 1', rent: null }],
        hasAskingPrice: null, askingPrice: null, targetCapRate: 7,
        showFinancing: false,
        financing: { downPct: 25, rate: 7.25, termYears: 25, closingPct: 2.5, targetCoC: 8 },
        overrides: {},
      });
      render();
    });
    restart.appendChild(restartBtn);

    const disclaimer = document.createElement('div');
    disclaimer.className = 'calc-disclaimer-inline';
    disclaimer.textContent = 'This is an educational estimate built from typical expense ratios and tax rates, not a real appraisal, rent roll, or lender underwriting. Swap in real numbers here as you get them — actual rents, a real tax bill, a real insurance quote — for a far more accurate picture.';

    els.body.append(actions, restart, disclaimer);
  }

  function render() {
    renderProgress();
    const name = STEPS[state.step];
    const map = {
      type: renderStepType,
      address: renderStepAddress,
      units: renderStepUnits,
      vacancy: renderStepVacancy,
      target: renderStepTarget,
      results: renderResults,
    };
    (map[name] || renderStepType)();
  }

  function init() {
    els.widget = document.getElementById('calc-widget');
    if (!els.widget) return;
    els.progress = document.getElementById('calc-progress');
    els.body = document.getElementById('calc-body');
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
