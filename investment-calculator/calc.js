// Property Investment Calculator
// All estimates are computed client-side from typical expense ratios and
// national/Michigan tax-rate approximations — there is no live rate feed,
// geocoding, or tax-record lookup here. Every automated number is clearly
// labeled "estimate" and is editable by the user. See
// /investment-calculator/methodology/ for the full explanation.
//
// Unlike the mortgage calculator, this is a persistent single-screen form,
// not a step wizard: every input stays visible and editable so you can
// adjust one number (rent, target return, vacancy...) and immediately see
// how the result changes, to compare scenarios quickly.

(function () {
  const TYPE_DEFAULTS = {
    multifamily: { label: 'Duplex / Small Multifamily', vacancy: 5, opex: 30 },
    office: { label: 'Office Building', vacancy: 10, opex: 20 },
    retail: { label: 'Retail / Mixed-Use Storefront', vacancy: 8, opex: 20 },
    other: { label: 'Other Investment Property', vacancy: 7, opex: 25 },
  };

  const state = {
    propertyType: 'multifamily',
    address: '',
    stateCode: '',
    units: [{ label: 'Unit 1', rent: null }],
    hasAskingPrice: false,
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

  // ---------- Core math (unchanged formulas, hand-verified) ----------

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
    if (state.stateCode !== 'MI') return 1.1;
    const taxableValueRatio = 0.5;
    const millage = 50;
    return taxableValueRatio * (millage / 10);
  }

  function insuranceRatePct() {
    return state.overrides.insuranceRatePct != null ? state.overrides.insuranceRatePct : 0.5;
  }

  function carryRatePct() {
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

  function hasIncome() {
    return state.units.some((u) => u.rent);
  }

  // ---------- Live-update plumbing ----------
  // Button/select changes rebuild the section they're in immediately (no
  // typing to interrupt). Number/text inputs only mutate state and schedule
  // a debounced results refresh, so typing never loses focus or cursor
  // position — only the results panel re-renders, never the form itself.

  let debounceTimer = null;
  function scheduleResultsUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderResults, 300);
  }

  function optionButton(label, sub, selected, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calc-option-btn' + (selected ? ' selected' : '');
    btn.innerHTML = `${label}${sub ? `<span class="calc-option-sub">${sub}</span>` : ''}`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function numberInput(value, placeholder, onInput, extraClass) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'calc-input' + (extraClass ? ` ${extraClass}` : '');
    input.inputMode = 'decimal';
    if (placeholder) input.placeholder = placeholder;
    if (value != null) input.value = value;
    input.addEventListener('input', () => {
      onInput(parseFloat(input.value));
      scheduleResultsUpdate();
    });
    return input;
  }

  // ---------- Form sections ----------

  function renderPropertyTypeSection() {
    const section = document.createElement('div');
    section.className = 'calc-form-section';
    const label = document.createElement('div');
    label.className = 'calc-section-label';
    label.textContent = 'Property type';
    const opts = document.createElement('div');
    opts.className = 'calc-options calc-options-wide';
    Object.entries(TYPE_DEFAULTS).forEach(([val, def]) => {
      opts.appendChild(optionButton(def.label, '', state.propertyType === val, () => {
        state.propertyType = val;
        state.overrides.vacancyPct = null;
        state.overrides.opExPct = null;
        renderForm();
        renderResults();
      }));
    });
    section.append(label, opts);
    return section;
  }

  function renderAddressSection() {
    const section = document.createElement('div');
    section.className = 'calc-form-section';
    const label = document.createElement('div');
    label.className = 'calc-section-label';
    label.textContent = 'Property location';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'calc-input';
    input.placeholder = 'Street address, city (for your own reference)';
    input.value = state.address;
    input.addEventListener('input', () => { state.address = input.value; });

    const select = document.createElement('select');
    select.className = 'calc-input';
    select.style.marginTop = '8px';
    [['', 'Select a state (for tax estimate)'], ['MI', 'Michigan'], ['OTHER', 'Other / not sure']].forEach(([val, lbl]) => {
      const o = document.createElement('option');
      o.value = val; o.textContent = lbl;
      if (state.stateCode === val) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => {
      state.stateCode = select.value;
      renderResults();
    });

    section.append(label, input, select);
    return section;
  }

  function updateUnitsTotal() {
    if (!els.unitsTotalEl) return;
    const monthly = state.units.reduce((sum, u) => sum + (u.rent || 0), 0);
    els.unitsTotalEl.textContent = `Total: ${fmtMoney(monthly)}/mo (${fmtMoney(monthly * 12)}/yr before vacancy)`;
  }

  function renderUnitsSection() {
    els.unitsContainer.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'calc-form-section';
    const label = document.createElement('div');
    label.className = 'calc-section-label';
    label.textContent = 'Rent or lease income';
    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.style.marginBottom = '10px';
    hint.textContent = 'Add a line for each unit or leased space, with its expected monthly rent.';
    section.append(label, hint);

    state.units.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'calc-unit-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'calc-input';
      labelInput.placeholder = `Unit ${i + 1}`;
      labelInput.value = u.label;
      labelInput.addEventListener('input', () => { u.label = labelInput.value; });

      const rentInput = numberInput(u.rent || '', 'Monthly rent $', (v) => {
        u.rent = v || null;
        updateUnitsTotal();
      });

      row.append(labelInput, rentInput);

      if (state.units.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'calc-unit-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', () => {
          state.units.splice(i, 1);
          renderUnitsSection();
          renderResults();
        });
        row.appendChild(removeBtn);
      }

      section.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'calc-add-unit';
    addBtn.textContent = '+ Add another unit / space';
    addBtn.addEventListener('click', () => {
      state.units.push({ label: `Unit ${state.units.length + 1}`, rent: null });
      renderUnitsSection();
      renderResults();
    });
    section.appendChild(addBtn);

    const total = document.createElement('div');
    total.className = 'calc-unit-total';
    els.unitsTotalEl = total;
    updateUnitsTotal();
    section.appendChild(total);

    els.unitsContainer.appendChild(section);
  }

  function renderAssumptionsSection() {
    els.assumptionsContainer.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'calc-form-section';
    const label = document.createElement('div');
    label.className = 'calc-section-label';
    label.textContent = 'Vacancy & target return';

    const row1 = document.createElement('div');
    row1.className = 'calc-field-row';
    const vacWrap = document.createElement('div');
    const vacLabel = document.createElement('label');
    vacLabel.textContent = `Vacancy % (typical: ${typeDefaults().vacancy}%)`;
    const vacInput = numberInput(vacancyPct(), null, (v) => { state.overrides.vacancyPct = isNaN(v) ? null : v; });
    vacWrap.append(vacLabel, vacInput);

    const targetWrap = document.createElement('div');
    const targetLabel = document.createElement('label');
    targetLabel.textContent = 'Target cap rate %';
    const targetInput = numberInput(state.targetCapRate, null, (v) => { state.targetCapRate = v || 0; });
    targetWrap.append(targetLabel, targetInput);

    row1.append(vacWrap, targetWrap);
    section.append(label, row1);

    const askLabel = document.createElement('div');
    askLabel.className = 'calc-hint';
    askLabel.style.marginTop = '4px';
    askLabel.textContent = 'Do you have an asking price to check?';
    const opts = document.createElement('div');
    opts.className = 'calc-options';
    [['no', 'Not yet'], ['yes', 'Yes']].forEach(([val, lbl]) => {
      opts.appendChild(optionButton(lbl, '', (state.hasAskingPrice ? 'yes' : 'no') === val, () => {
        state.hasAskingPrice = val === 'yes';
        renderAssumptionsSection();
        renderResults();
      }));
    });
    section.append(askLabel, opts);

    if (state.hasAskingPrice) {
      const priceInput = numberInput(state.askingPrice || '', 'Asking price $', (v) => { state.askingPrice = v || null; });
      priceInput.style.marginTop = '10px';
      section.appendChild(priceInput);
    }

    els.assumptionsContainer.appendChild(section);
  }

  function renderFinancingSection() {
    els.financingContainer.innerHTML = '';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'calc-breakdown-toggle';
    toggle.textContent = state.showFinancing ? 'Hide financing / cash-on-cash' : 'Also factor in financing (cash-on-cash return)';
    toggle.addEventListener('click', () => {
      state.showFinancing = !state.showFinancing;
      renderFinancingSection();
      renderResults();
    });
    els.financingContainer.appendChild(toggle);

    if (!state.showFinancing) return;

    const panel = document.createElement('div');
    panel.className = 'calc-financing-panel';

    function field(labelText, key, step) {
      const wrap = document.createElement('div');
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      const input = numberInput(state.financing[key], null, (v) => { state.financing[key] = isNaN(v) ? 0 : v; });
      input.step = step;
      wrap.append(lbl, input);
      return wrap;
    }

    const row1 = document.createElement('div');
    row1.className = 'calc-field-row';
    row1.append(field('Down payment (%)', 'downPct', '1'), field('Closing costs (%)', 'closingPct', '0.5'));
    const row2 = document.createElement('div');
    row2.className = 'calc-field-row';
    row2.append(field('Interest rate (%)', 'rate', '0.125'), field('Loan term (years)', 'termYears', '1'));
    panel.append(row1, row2, field('Target cash-on-cash (%)', 'targetCoC', '0.5'));
    els.financingContainer.appendChild(panel);
  }

  function renderForm() {
    els.form.innerHTML = '';
    els.form.appendChild(renderPropertyTypeSection());
    els.form.appendChild(renderAddressSection());

    els.unitsContainer = document.createElement('div');
    els.form.appendChild(els.unitsContainer);
    renderUnitsSection();

    els.assumptionsContainer = document.createElement('div');
    els.form.appendChild(els.assumptionsContainer);
    renderAssumptionsSection();

    els.financingContainer = document.createElement('div');
    els.form.appendChild(els.financingContainer);
    renderFinancingSection();
  }

  // ---------- Results (re-rendered live, never destroys the form) ----------

  function editableRow(label, value, key, isPercent) {
    const tr = document.createElement('tr');
    tr.className = 'calc-editable';
    const td1 = document.createElement('td');
    td1.innerHTML = `${label}<span class="calc-estimate-tag">Estimate</span>`;
    const td2 = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'calc-edit-input';
    input.step = isPercent ? '0.05' : '1';
    input.value = value.toFixed(2);
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) state.overrides[key] = v;
      renderResults();
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
    els.results.innerHTML = '';

    if (!hasIncome()) {
      const placeholder = document.createElement('div');
      placeholder.className = 'calc-hint';
      placeholder.style.textAlign = 'center';
      placeholder.style.padding = '20px 0';
      placeholder.textContent = 'Enter at least one rent or lease amount above to see your estimate.';
      els.results.appendChild(placeholder);
      return;
    }

    const suggestedPrice = suggestedPriceForCapRate(state.targetCapRate);
    const hasAsking = state.hasAskingPrice && state.askingPrice;
    const askingAnalysis = hasAsking ? analyzeAtPrice(state.askingPrice) : null;

    if (!state.resultsTracked) {
      state.resultsTracked = true;
      if (typeof gtag === 'function') {
        gtag('event', 'investment_calculator_result_viewed', {
          property_type: state.propertyType || undefined,
          state_code: state.stateCode || undefined,
          had_asking_price: !!hasAsking,
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

    els.results.append(head, card1);

    if (askingAnalysis) {
      const card2 = document.createElement('div');
      card2.className = 'calc-result-card';
      card2.innerHTML = `
        <div class="calc-result-label">At the asking price of ${fmtMoney(state.askingPrice)}</div>
        <div class="calc-result-value">${fmtPct(askingAnalysis.capRate * 100)}<span style="font-size:15px;font-weight:600;"> cap rate</span></div>
        <div class="calc-result-includes">Estimated net operating income of ${fmtMoney(Math.round(askingAnalysis.noi))}/yr at that price.</div>
      `;
      els.results.appendChild(card2);
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'calc-breakdown-toggle';
    toggle.textContent = els.breakdownOpen ? 'Hide the complete breakdown' : 'Show the complete breakdown';

    const table = document.createElement('table');
    table.className = 'calc-breakdown-table';
    table.style.display = els.breakdownOpen ? 'table' : 'none';
    table.appendChild(staticRow('Gross potential income (annual)', fmtMoney(grossPotentialIncomeAnnual())));
    table.appendChild(editableRow('Vacancy & credit loss (%)', vacancyPct(), 'vacancyPct', true));
    table.appendChild(staticRow('Effective gross income', fmtMoney(Math.round(egiAnnual()))));
    table.appendChild(editableRow('Operating expenses (% of EGI — mgmt, maintenance, misc.)', opExPct(), 'opExPct', true));
    table.appendChild(editableRow('Property tax rate (% of price)', taxRatePct(), 'taxRatePct', true));
    table.appendChild(editableRow('Insurance rate (% of price)', insuranceRatePct(), 'insuranceRatePct', true));
    if (askingAnalysis) {
      table.appendChild(staticRow(`Net operating income at ${fmtMoney(state.askingPrice)}`, fmtMoney(Math.round(askingAnalysis.noi)), true));
    }

    toggle.addEventListener('click', () => {
      els.breakdownOpen = !els.breakdownOpen;
      renderResults();
    });

    els.results.append(toggle, table);

    if (state.showFinancing) {
      // Cash flow needs a specific price to run the numbers at. Use the real
      // asking price if there is one; otherwise fall back to the suggested
      // price so this is always useful, not just when an asking price is typed in.
      const cashFlowPrice = hasAsking ? state.askingPrice : suggestedPrice;
      const cashFlowAnalysis = cashFlowPrice ? analyzeAtPrice(cashFlowPrice) : null;
      const cashFlowPriceLabel = hasAsking
        ? `at your asking price of ${fmtMoney(state.askingPrice)}`
        : `at the suggested price of ${fmtMoney(Math.round(cashFlowPrice))}`;

      if (cashFlowAnalysis) {
        const monthlyNOI = cashFlowAnalysis.noi / 12;
        const monthlyDebtService = cashFlowAnalysis.annualDebtService / 12;
        const monthlyCashFlow = cashFlowAnalysis.cashFlow / 12;
        const positive = monthlyCashFlow >= 0;

        const cfCard = document.createElement('div');
        cfCard.className = 'calc-result-card calc-cashflow-card ' + (positive ? 'calc-cf-positive' : 'calc-cf-negative');
        cfCard.innerHTML = `
          <div class="calc-result-label">Monthly cash flow ${cashFlowPriceLabel}</div>
          <div class="calc-result-value">${positive ? '' : '&minus;'}${fmtMoney(Math.abs(Math.round(monthlyCashFlow)))}<span style="font-size:15px;font-weight:600;">/mo</span></div>
          <div class="calc-result-includes">What's left every month after rent, vacancy, operating expenses, property tax, insurance, and the mortgage payment (${fmtMoney(Math.round(monthlyDebtService))}/mo at ${state.financing.rate}% over ${state.financing.termYears} years, ${state.financing.downPct}% down).</div>
        `;
        els.results.appendChild(cfCard);

        const cfStats = document.createElement('div');
        cfStats.className = 'calc-stat-grid';
        cfStats.innerHTML = `
          <div class="calc-stat-box">
            <div class="calc-stat-label">Monthly income (NOI)</div>
            <div class="calc-stat-value">${fmtMoney(Math.round(monthlyNOI))}</div>
          </div>
          <div class="calc-stat-box">
            <div class="calc-stat-label">Monthly mortgage payment</div>
            <div class="calc-stat-value">${fmtMoney(Math.round(monthlyDebtService))}</div>
          </div>
          <div class="calc-stat-box">
            <div class="calc-stat-label">DSCR</div>
            <div class="calc-stat-value">${cashFlowAnalysis.dscr != null ? cashFlowAnalysis.dscr.toFixed(2) : '—'}</div>
          </div>
        `;
        els.results.appendChild(cfStats);

        const cfStats2 = document.createElement('div');
        cfStats2.className = 'calc-stat-grid';
        cfStats2.style.gridTemplateColumns = '1fr 1fr';
        cfStats2.innerHTML = `
          <div class="calc-stat-box">
            <div class="calc-stat-label">Cash-on-cash return ${cashFlowPriceLabel}</div>
            <div class="calc-stat-value">${fmtPct(cashFlowAnalysis.coc * 100)}</div>
          </div>
          <div class="calc-stat-box">
            <div class="calc-stat-label">Cash needed (down + closing)</div>
            <div class="calc-stat-value">${fmtMoney(Math.round(cashFlowAnalysis.cashInvested))}</div>
          </div>
        `;
        els.results.appendChild(cfStats2);
      }

      const priceForCoC = suggestedPriceForCashOnCash(state.financing.targetCoC);
      const cocHead = document.createElement('div');
      cocHead.className = 'calc-stat-grid';
      cocHead.style.gridTemplateColumns = '1fr 1fr';
      cocHead.innerHTML = `
        <div class="calc-stat-box">
          <div class="calc-stat-label">Price for ${fmtPct(state.financing.targetCoC)} cash-on-cash</div>
          <div class="calc-stat-value">${priceForCoC != null ? fmtMoney(Math.round(priceForCoC)) : '—'}</div>
        </div>
        <div class="calc-stat-box">
          <div class="calc-stat-label">Target cash-on-cash</div>
          <div class="calc-stat-value">${fmtPct(state.financing.targetCoC)}</div>
        </div>
      `;
      els.results.appendChild(cocHead);

      const financeHint = document.createElement('div');
      financeHint.className = 'calc-hint';
      financeHint.style.marginTop = '10px';
      financeHint.textContent = 'Cash flow is your monthly income after every expense and the mortgage payment. Cash-on-cash return is annual cash flow divided by the cash you actually put in (down payment + closing costs). DSCR is net operating income divided by the mortgage payment — most lenders want at least 1.20. Type in an asking price above to see these at a specific price instead of the suggested one.';
      els.results.appendChild(financeHint);
    }

    const actions = document.createElement('div');
    actions.className = 'calc-actions';
    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'calc-btn';
    printBtn.textContent = 'Print / Save PDF';
    printBtn.addEventListener('click', () => window.print());
    actions.appendChild(printBtn);
    els.results.appendChild(actions);

    const disclaimer = document.createElement('div');
    disclaimer.className = 'calc-disclaimer-inline';
    disclaimer.textContent = 'This is an educational estimate built from typical expense ratios and tax rates, not a real appraisal, rent roll, or lender underwriting. Swap in real numbers here as you get them — actual rents, a real tax bill, a real insurance quote — for a far more accurate picture. Adjust any number above and the estimate updates right away, so you can compare scenarios.';
    els.results.appendChild(disclaimer);
  }

  function renderResetLink() {
    const wrap = document.createElement('div');
    wrap.className = 'calc-restart';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Start over';
    btn.addEventListener('click', () => {
      Object.assign(state, {
        propertyType: 'multifamily', address: '', stateCode: '',
        units: [{ label: 'Unit 1', rent: null }],
        hasAskingPrice: false, askingPrice: null, targetCapRate: 7,
        showFinancing: false,
        financing: { downPct: 25, rate: 7.25, termYears: 25, closingPct: 2.5, targetCoC: 8 },
        overrides: {},
      });
      els.breakdownOpen = false;
      renderForm();
      renderResults();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  function init() {
    els.widget = document.getElementById('calc-widget');
    if (!els.widget) return;
    const progress = document.getElementById('calc-progress');
    if (progress) progress.remove();
    els.body = document.getElementById('calc-body');
    els.form = document.createElement('div');
    els.results = document.createElement('div');
    els.results.className = 'calc-results-live';
    els.body.append(els.form, els.results);
    els.body.appendChild(renderResetLink());
    els.breakdownOpen = false;
    renderForm();
    renderResults();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
