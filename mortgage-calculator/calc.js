// Mortgage & House-Payment Calculator
// All estimates are computed client-side from published/typical rate tables and
// national averages — there is no live rate feed, geocoding, or tax-record
// lookup here. Every automated number is clearly labeled "estimate" and is
// editable by the user in the breakdown. See /mortgage-calculator/methodology/
// for the full explanation of every assumption below.

(function () {
  const state = {
    step: 0,
    homePrice: null,
    location: '',
    stateCode: '',
    downPct: 20,
    downCustom: null,
    credit: null,
    circumstances: [],
    hoaChoice: null,
    hoaAmount: 0,
    use: null,
    // overrides, set once the user edits a breakdown field
    overrides: {},
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

  function downPaymentAmount() {
    const price = state.homePrice || 0;
    if (state.downPct === 'custom') return state.downCustom || 0;
    return Math.round(price * (state.downPct / 100));
  }

  function downPaymentPct() {
    const price = state.homePrice || 0;
    if (!price) return 0;
    return (downPaymentAmount() / price) * 100;
  }

  function suggestedLoanType() {
    const pct = downPaymentPct();
    if (state.circumstances.includes('veteran')) return 'VA';
    if (state.circumstances.includes('rural') && !state.circumstances.includes('veteran')) return 'USDA';
    if (state.circumstances.includes('firstTime') && ['fair', 'poor', 'unknown'].includes(state.credit)) return 'FHA';
    if (pct < 5) return 'FHA';
    return 'Conventional';
  }

  function baseRate() {
    // Editable "current sample rate" starting point for a well-qualified
    // conventional 30-year primary-residence buyer. UPDATE PERIODICALLY —
    // this is not a live feed. See methodology page.
    return state.overrides.baseRate != null ? state.overrides.baseRate : 6.75;
  }

  function estimatedRate() {
    let r = baseRate();
    const loanType = suggestedLoanType();
    if (loanType === 'FHA') r -= 0.25;
    if (loanType === 'VA') r -= 0.375;
    if (loanType === 'USDA') r -= 0.125;

    const creditAdj = { excellent: -0.25, good: 0, fair: 0.375, poor: 0.75, unknown: 0.25 };
    r += creditAdj[state.credit] ?? 0.25;

    const pct = downPaymentPct();
    if (pct < 10) r += 0.125;
    else if (pct >= 20) r -= 0.125;

    if (state.use === 'second') r += 0.375;
    if (state.use === 'rental') r += 0.625;

    r = Math.round(r * 8) / 8; // nearest 0.125
    return Math.max(r, 2);
  }

  function isMichiganHomestead() {
    // Michigan's Principal Residence Exemption (PRE) excuses an owner-occupied
    // primary residence from the local school operating millage (typically
    // ~18 mills) that non-homestead property still pays. This is the single
    // biggest lever on a Michigan buyer's real tax bill, bigger than most
    // county-to-county variation — modeling it beats a single flat rate.
    return state.use === 'primary';
  }

  function estimatedTaxRateAnnual() {
    if (state.overrides.taxRate != null) return state.overrides.taxRate;
    if (state.stateCode !== 'MI') return 1.1; // national average effective rate

    // Michigan taxes = taxable value × total millage / 1000. Taxable value
    // resets to roughly the state equalized value (SEV) the year after a
    // sale (see methodology/FAQ), and SEV is constitutionally capped at
    // ~50% of true cash value — so taxable value is approximated here as
    // 50% of price. Millage varies by township/school district; these are
    // statewide-average approximations, not a per-municipality lookup.
    const taxableValueRatio = 0.5;
    const millage = isMichiganHomestead() ? 32 : 50; // mills; non-homestead pays the ~18-mill school operating tax homestead is exempt from
    return taxableValueRatio * (millage / 10); // e.g. 0.5 * 32/10 = 1.6%
  }

  function estimatedInsuranceAnnual() {
    if (state.overrides.insuranceAnnual != null) return state.overrides.insuranceAnnual;
    let base = (state.homePrice || 0) * 0.0035;
    if (state.use === 'rental') base *= 1.4;
    if (state.use === 'second') base *= 1.15;
    return Math.round(base);
  }

  function pmiMonthly(loanAmount, rate) {
    const loanType = suggestedLoanType();
    const pct = downPaymentPct();

    if (loanType === 'FHA') {
      const annualRate = state.overrides.mipRate != null ? state.overrides.mipRate : 0.55;
      return Math.round((loanAmount * (annualRate / 100)) / 12);
    }
    if (loanType === 'VA' || loanType === 'USDA') {
      // VA has no monthly PMI (funding fee is upfront/financed).
      // USDA has an annual fee similar in spirit to PMI.
      if (loanType === 'USDA') {
        const annualRate = state.overrides.mipRate != null ? state.overrides.mipRate : 0.35;
        return Math.round((loanAmount * (annualRate / 100)) / 12);
      }
      return 0;
    }
    // Conventional
    if (pct >= 20) return 0;
    const creditPmi = { excellent: 0.45, good: 0.65, fair: 0.95, poor: 1.25, unknown: 1.1 };
    let annualRate = state.overrides.mipRate != null ? state.overrides.mipRate : (creditPmi[state.credit] ?? 0.9);
    if (pct < 5) annualRate += 0.2;
    else if (pct < 10) annualRate += 0.1;
    return Math.round((loanAmount * (annualRate / 100)) / 12);
  }

  function upfrontFee(loanAmount) {
    // FHA upfront MIP, VA funding fee, USDA guarantee fee — these are
    // typically financed into the loan, not required as cash at closing.
    const loanType = suggestedLoanType();
    const pct = downPaymentPct();
    if (loanType === 'FHA') return Math.round(loanAmount * 0.0175);
    if (loanType === 'VA') {
      let feePct = pct >= 10 ? 1.25 : pct >= 5 ? 1.5 : 2.15;
      return Math.round(loanAmount * (feePct / 100));
    }
    if (loanType === 'USDA') return Math.round(loanAmount * 0.01);
    return 0;
  }

  function monthlyPI(loanAmount, annualRate) {
    const r = annualRate / 100 / 12;
    const n = 360;
    if (r === 0) return loanAmount / n;
    return (loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }

  function compute() {
    const price = state.homePrice || 0;
    const down = downPaymentAmount();
    const loanAmount = Math.max(price - down, 0);
    const rate = estimatedRate();
    const pi = monthlyPI(loanAmount, rate);
    const taxAnnual = price * (estimatedTaxRateAnnual() / 100);
    const taxMonthly = taxAnnual / 12;
    const insAnnual = estimatedInsuranceAnnual();
    const insMonthly = insAnnual / 12;
    const pmi = pmiMonthly(loanAmount, rate);
    const hoaMonthly = state.hoaChoice === 'yes' ? (state.hoaAmount || 0) : 0;

    const totalMonthly = pi + taxMonthly + insMonthly + pmi + hoaMonthly;

    const lenderTitleCosts = Math.round(loanAmount * 0.02);
    const appraisal = 550;
    const inspection = 450;
    const prepaidEscrow = Math.round((taxMonthly + insMonthly) * 3);
    const dailyInterest = (loanAmount * (rate / 100)) / 365;
    const prepaidInterest = Math.round(dailyInterest * 15);
    const closingCosts = lenderTitleCosts + appraisal + inspection + prepaidEscrow + prepaidInterest;
    const financedFee = upfrontFee(loanAmount);
    const cashToClose = down + closingCosts;

    return {
      price, down, loanAmount, rate, pi, taxAnnual, taxMonthly, insAnnual, insMonthly,
      pmi, hoaMonthly, totalMonthly, lenderTitleCosts, appraisal, inspection,
      prepaidEscrow, prepaidInterest, closingCosts, financedFee, cashToClose,
      loanType: suggestedLoanType(),
    };
  }

  // ---------- Step definitions ----------
  const STEPS = ['price', 'down', 'location', 'credit', 'circumstances', 'hoa', 'use', 'results'];

  function renderProgress() {
    const total = STEPS.length - 1; // exclude results from the dots
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

  function renderStepPrice() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 1 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'What is the price of the home?';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'calc-input-large';
    input.placeholder = '$ 300,000';
    input.inputMode = 'numeric';
    input.value = state.homePrice || '';
    input.addEventListener('input', () => {
      state.homePrice = parseFloat(input.value) || null;
      updateNext();
    });
    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.textContent = "Haven't chosen a house yet? Enter your target budget — you can change this anytime.";

    els.body.append(eyebrow, q, input, hint);
    const nav = navRow(!!state.homePrice, next);
    els.body.appendChild(nav);

    function updateNext() {
      nav.querySelector('.calc-btn-primary').disabled = !state.homePrice;
    }
    setTimeout(() => input.focus(), 50);
  }

  function renderStepDown() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 2 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'How much would you like to put down?';

    const opts = document.createElement('div');
    opts.className = 'calc-options';
    const choices = [0, 3, 3.5, 5, 10, 20];
    choices.forEach((pct) => {
      const dollar = Math.round((state.homePrice || 0) * (pct / 100));
      const btn = optionButton(
        `${pct}%`,
        state.homePrice ? fmtMoney(dollar) : '',
        state.downPct === pct,
        () => { state.downPct = pct; renderStepDown(); }
      );
      opts.appendChild(btn);
    });
    const customBtn = optionButton('Another amount', '', state.downPct === 'custom', () => {
      state.downPct = 'custom';
      renderStepDown();
    });
    opts.appendChild(customBtn);

    els.body.append(eyebrow, q, opts);

    if (state.downPct === 'custom') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'calc-input';
      input.style.marginTop = '14px';
      input.placeholder = 'Down payment amount ($)';
      input.value = state.downCustom || '';
      input.addEventListener('input', () => {
        state.downCustom = parseFloat(input.value) || null;
        nav.querySelector('.calc-btn-primary').disabled = !state.downCustom;
      });
      els.body.appendChild(input);
    }

    const canGo = state.downPct !== 'custom' || !!state.downCustom;
    const nav = navRow(canGo, next);
    els.body.appendChild(nav);
  }

  function renderStepLocation() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 3 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'Where is the home?';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'calc-input';
    input.placeholder = 'City, or full address (optional)';
    input.value = state.location;
    input.addEventListener('input', () => { state.location = input.value; });

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

    els.body.append(eyebrow, q, input, stateLabel, select);
    const nav = navRow(true, next);
    els.body.appendChild(nav);
  }

  function renderStepCredit() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 4 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'About where is your credit?';

    const opts = document.createElement('div');
    opts.className = 'calc-options calc-options-wide';
    const choices = [
      ['excellent', 'Excellent', '740+'],
      ['good', 'Good', '680–739'],
      ['fair', 'Fair', '620–679'],
      ['poor', 'Needs improvement', 'Below 620'],
      ['unknown', "I don't know", ''],
    ];
    choices.forEach(([val, label, sub]) => {
      opts.appendChild(optionButton(label, sub, state.credit === val, () => {
        state.credit = val;
        renderStepCredit();
      }));
    });

    els.body.append(eyebrow, q, opts);
    const nav = navRow(!!state.credit, next);
    els.body.appendChild(nav);
  }

  function renderStepCircumstances() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 5 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'Do any of these apply?';
    const hint = document.createElement('div');
    hint.className = 'calc-hint';
    hint.style.marginBottom = '14px';
    hint.textContent = 'Select any that apply — this helps suggest a starting loan type.';

    const opts = document.createElement('div');
    opts.className = 'calc-options calc-options-wide';
    const choices = [
      ['firstTime', 'First-time buyer'],
      ['veteran', 'Veteran or active military'],
      ['rural', 'Rural property'],
      ['none', 'None of these'],
    ];
    choices.forEach(([val, label]) => {
      const selected = state.circumstances.includes(val);
      opts.appendChild(optionButton(label, '', selected, () => {
        if (val === 'none') {
          state.circumstances = selected ? [] : ['none'];
        } else {
          state.circumstances = state.circumstances.filter((v) => v !== 'none');
          if (selected) state.circumstances = state.circumstances.filter((v) => v !== val);
          else state.circumstances.push(val);
        }
        renderStepCircumstances();
      }));
    });

    els.body.append(eyebrow, q, hint, opts);
    const nav = navRow(true, next);
    els.body.appendChild(nav);
  }

  function renderStepHoa() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 6 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'Does the home have an HOA fee?';

    const opts = document.createElement('div');
    opts.className = 'calc-options';
    [['no', 'No'], ['yes', 'Yes'], ['unknown', "I don't know"]].forEach(([val, label]) => {
      opts.appendChild(optionButton(label, '', state.hoaChoice === val, () => {
        state.hoaChoice = val;
        renderStepHoa();
      }));
    });

    els.body.append(eyebrow, q, opts);

    if (state.hoaChoice === 'yes') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'calc-input';
      input.style.marginTop = '14px';
      input.placeholder = 'Monthly HOA fee ($)';
      input.value = state.hoaAmount || '';
      input.addEventListener('input', () => { state.hoaAmount = parseFloat(input.value) || 0; });
      els.body.appendChild(input);
    }

    const nav = navRow(!!state.hoaChoice, next);
    els.body.appendChild(nav);
  }

  function renderStepUse() {
    els.body.innerHTML = '';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'calc-eyebrow';
    eyebrow.textContent = 'Step 7 of 7';
    const q = document.createElement('div');
    q.className = 'calc-question';
    q.textContent = 'How will the property be used?';

    const opts = document.createElement('div');
    opts.className = 'calc-options calc-options-wide';
    [['primary', 'Primary home'], ['second', 'Second home'], ['rental', 'Rental property']].forEach(([val, label]) => {
      opts.appendChild(optionButton(label, '', state.use === val, () => {
        state.use = val;
        renderStepUse();
      }));
    });

    els.body.append(eyebrow, q, opts);
    const nav = navRow(!!state.use, () => { goTo(STEPS.length - 1); }, 'See my estimate');
    els.body.appendChild(nav);
  }

  function editableRow(label, value, key, isMoney, isPercent) {
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
      renderResults();
    });
    td2.appendChild(input);
    tr.append(td1, td2);
    return tr;
  }

  function staticRow(label, value) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = label;
    const td2 = document.createElement('td');
    td2.textContent = value;
    tr.append(td1, td2);
    return tr;
  }

  function renderResults() {
    els.body.innerHTML = '';
    const r = compute();

    const head = document.createElement('div');
    head.className = 'calc-results-head';
    let michiganNote = '';
    if (state.stateCode === 'MI') {
      michiganNote = isMichiganHomestead()
        ? '<p>Taxed as a Michigan <strong>homestead</strong> — the Principal Residence Exemption excuses primary residences from the local school operating millage.</p>'
        : '<p>Taxed as <strong>non-homestead</strong> Michigan property — second homes and rentals don’t qualify for the Principal Residence Exemption, so the tax estimate is higher.</p>';
    }
    head.innerHTML = `<div class="calc-eyebrow">Your estimate</div><p>Suggested starting loan type: <strong>${r.loanType}</strong> — not an approval or a rate lock.</p>${michiganNote}`;

    const card1 = document.createElement('div');
    card1.className = 'calc-result-card';
    card1.innerHTML = `
      <div class="calc-result-label">Estimated monthly house payment</div>
      <div class="calc-result-value">${fmtMoney(Math.round(r.totalMonthly))}<span style="font-size:15px;font-weight:600;">/mo</span></div>
      <div class="calc-result-includes">Includes principal &amp; interest, estimated property taxes, homeowners insurance${r.pmi ? ', mortgage insurance' : ''}${r.hoaMonthly ? ', HOA' : ''}.</div>
    `;

    const card2 = document.createElement('div');
    card2.className = 'calc-result-card';
    card2.innerHTML = `
      <div class="calc-result-label">Estimated cash needed to buy</div>
      <div class="calc-result-value">${fmtMoney(Math.round(r.cashToClose))}</div>
      <div class="calc-result-includes">Down payment, estimated closing costs, prepaid taxes/insurance, and an inspection allowance.${r.financedFee ? ` (${fmtMoney(r.financedFee)} in upfront loan fees is typically financed into the loan, not paid as cash.)` : ''}</div>
    `;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'calc-breakdown-toggle';
    toggle.textContent = 'Show the complete breakdown';

    const table = document.createElement('table');
    table.className = 'calc-breakdown-table';
    table.style.display = 'none';
    table.appendChild(staticRow('Home price', fmtMoney(r.price)));
    table.appendChild(staticRow('Down payment', `${fmtMoney(r.down)} (${downPaymentPct().toFixed(1)}%)`));
    table.appendChild(staticRow('Loan amount', fmtMoney(r.loanAmount)));
    table.appendChild(editableRow('Interest rate (30-yr)', r.rate, 'baseRate', false, true));
    table.appendChild(staticRow('Principal & interest / mo', fmtMoney(Math.round(r.pi))));
    table.appendChild(editableRow('Property tax rate (annual, % of price)', estimatedTaxRateAnnual(), 'taxRate', false, true));
    table.appendChild(staticRow('Property tax / mo', fmtMoney(Math.round(r.taxMonthly))));
    table.appendChild(editableRow('Homeowners insurance (annual $)', estimatedInsuranceAnnual(), 'insuranceAnnual', true));
    table.appendChild(staticRow('Insurance / mo', fmtMoney(Math.round(r.insMonthly))));
    if (r.pmi) table.appendChild(staticRow('Mortgage insurance / mo', fmtMoney(r.pmi)));
    if (r.hoaMonthly) table.appendChild(staticRow('HOA / mo', fmtMoney(r.hoaMonthly)));
    table.appendChild(staticRow('— Closing costs —', ''));
    table.appendChild(staticRow('Lender, title & appraisal fees', fmtMoney(r.lenderTitleCosts + r.appraisal)));
    table.appendChild(staticRow('Inspection allowance', fmtMoney(r.inspection)));
    table.appendChild(staticRow('Prepaid taxes & insurance (escrow)', fmtMoney(r.prepaidEscrow)));
    table.appendChild(staticRow('Prepaid interest', fmtMoney(r.prepaidInterest)));
    if (r.financedFee) table.appendChild(staticRow(`${r.loanType} upfront fee (financed, not cash)`, fmtMoney(r.financedFee)));

    toggle.addEventListener('click', () => {
      const open = table.style.display !== 'none';
      table.style.display = open ? 'none' : 'table';
      toggle.textContent = open ? 'Show the complete breakdown' : 'Hide the complete breakdown';
    });

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
        step: 0, homePrice: null, location: '', stateCode: '', downPct: 20, downCustom: null,
        credit: null, circumstances: [], hoaChoice: null, hoaAmount: 0, use: null, overrides: {},
      });
      render();
    });
    restart.appendChild(restartBtn);

    const disclaimer = document.createElement('div');
    disclaimer.className = 'calc-disclaimer-inline';
    disclaimer.textContent = 'This is an educational estimate, not a loan approval, rate lock, insurance quote, or tax bill. See our methodology and disclaimer for details.';

    els.body.append(head, card1, card2, toggle, table, actions, restart, disclaimer);
  }

  function render() {
    renderProgress();
    const name = STEPS[state.step];
    const map = {
      price: renderStepPrice,
      down: renderStepDown,
      location: renderStepLocation,
      credit: renderStepCredit,
      circumstances: renderStepCircumstances,
      hoa: renderStepHoa,
      use: renderStepUse,
      results: renderResults,
    };
    (map[name] || renderStepPrice)();
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
