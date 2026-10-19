import { LightningElement, api, track } from 'lwc';

/**
 * Patient Journey Simulator
 * Full-screen, touch-first LWC for pharma sales reps.
 * Visualizes how a patient cohort flows from diagnosis -> adherence,
 * highlights the biggest drop-off, and lets the rep model "what-if"
 * interventions that re-flow the funnel live.
 *
 * Self-contained: all data is mock so the demo always renders cleanly.
 */

const STARTING_COHORT = 1000;

// Base journey. `baseRate` = share of the PRIOR stage that advances.
// Each stage names the drop-off driver and the rep lever that can move it.
const BASE_STAGES = [
    {
        key: 'diagnosed',
        label: 'Diagnosed',
        sublabel: 'Confirmed eligible patients',
        icon: 'utility:health',
        baseRate: 1, // entry point
        dropReason: null,
        detail: 'Patients formally diagnosed and clinically eligible for IMMUNEXIS therapy. This is the top of the funnel.',
        repAction: null
    },
    {
        key: 'prescribed',
        label: 'Prescribed',
        sublabel: 'HCP writes the script',
        icon: 'utility:edit',
        baseRate: 0.84,
        dropReason: 'Clinical inertia / awareness',
        detail: 'HCP decides to initiate therapy. Loss here is usually low product awareness or comfort with the mechanism of action.',
        repAction: 'Deliver the latest efficacy data and MOA visual during your next detail.'
    },
    {
        key: 'approved',
        label: 'PA Approved',
        sublabel: 'Payer clears prior auth',
        icon: 'utility:shield',
        baseRate: 0.72,
        dropReason: 'Prior authorization friction',
        detail: 'Prior authorization is the single largest leak in the specialty journey. Scripts stall or are abandoned in payer review.',
        repAction: 'Enroll the office in the PA support hub and share the payer coverage grid.'
    },
    {
        key: 'started',
        label: 'Started Therapy',
        sublabel: 'First fill picked up',
        icon: 'utility:success',
        baseRate: 0.9,
        dropReason: 'Cost / copay shock at pharmacy',
        detail: 'Patient reaches the pharmacy but abandons at the counter, most often due to out-of-pocket cost.',
        repAction: 'Activate the copay savings card and patient assistance program.'
    },
    {
        key: 'adherent',
        label: 'Adherent',
        sublabel: 'On therapy at 90 days',
        icon: 'utility:favorite',
        baseRate: 0.78,
        dropReason: 'Early discontinuation',
        detail: 'Patients drop off in the first 90 days from side-effect management gaps or lack of follow-up.',
        repAction: 'Connect the office with the nurse educator and adherence text program.'
    }
];

// What-if levers. Each lifts the conversion rate of a target stage.
const LEVERS = [
    {
        key: 'pa',
        label: 'PA Support Hub',
        icon: 'utility:shield',
        target: 'approved',
        maxLift: 0.2, // up to +20 percentage points of conversion
        blurb: 'Reduce prior-auth abandonment'
    },
    {
        key: 'copay',
        label: 'Copay Assistance',
        icon: 'utility:moneybag',
        target: 'started',
        maxLift: 0.09,
        blurb: 'Cut cost-driven drop at pharmacy'
    },
    {
        key: 'nurse',
        label: 'Nurse Educator',
        icon: 'utility:people',
        target: 'adherent',
        maxLift: 0.15,
        blurb: 'Improve 90-day persistence'
    }
];

export default class PatientJourneySimulator extends LightningElement {
    // Set from the App Builder property (see .js-meta.xml). The mobile web
    // container gives the component a zero/auto height, so we use this to give
    // the root an explicit pixel height instead of relying on 100%/100vh.
    @api mobileHeight = 700;

    @track levers = LEVERS.map((l) => ({ ...l, value: 0 })); // 0..100 slider
    selectedKey = 'approved'; // default focus on the biggest leak
    animateKey = 0;

    // Inline style applied to the root so the funnel has a real height on mobile.
    get rootStyle() {
        return `min-height:${this.mobileHeight}px`;
    }

    // ---- core computation ---------------------------------------------------

    get computedStages() {
        const liftByStage = {};
        this.levers.forEach((l) => {
            liftByStage[l.target] = (l.value / 100) * l.maxLift;
        });

        let running = STARTING_COHORT;
        let prev = STARTING_COHORT;
        const maxBar = STARTING_COHORT;

        return BASE_STAGES.map((stage, idx) => {
            const lift = liftByStage[stage.key] || 0;
            const effectiveRate = Math.min(1, stage.baseRate + lift);
            const count = idx === 0 ? STARTING_COHORT : Math.round(prev * effectiveRate);
            const conversionPct = idx === 0 ? 100 : Math.round(effectiveRate * 100);
            const dropCount = idx === 0 ? 0 : prev - count;
            const pctOfStart = Math.round((count / STARTING_COHORT) * 100);

            prev = count;
            running = count;

            const widthPct = Math.max(6, (count / maxBar) * 100);
            const isSelected = stage.key === this.selectedKey;
            const boosted = lift > 0.001;

            return {
                ...stage,
                count,
                countDisplay: count.toLocaleString(),
                conversionPct,
                dropCount,
                dropDisplay: dropCount.toLocaleString(),
                pctOfStart,
                widthStyle: `width:${widthPct}%`,
                barClass: `pjs-bar${isSelected ? ' pjs-bar_selected' : ''}${boosted ? ' pjs-bar_boosted' : ''}`,
                isSelected,
                boosted,
                stageNumber: idx + 1,
                showConnector: idx > 0
            };
        });
    }

    // Final adherent count and lift vs. baseline.
    get finalCount() {
        const stages = this.computedStages;
        return stages[stages.length - 1].count;
    }

    get finalPct() {
        return Math.round((this.finalCount / STARTING_COHORT) * 100);
    }

    get baselineFinal() {
        let prev = STARTING_COHORT;
        BASE_STAGES.forEach((s, i) => {
            if (i > 0) prev = Math.round(prev * s.baseRate);
        });
        return prev;
    }

    get patientsGained() {
        return this.finalCount - this.baselineFinal;
    }

    get patientsGainedDisplay() {
        const g = this.patientsGained;
        return `${g >= 0 ? '+' : ''}${g.toLocaleString()}`;
    }

    get hasGain() {
        return this.patientsGained > 0;
    }

    get gainClass() {
        return this.hasGain ? 'pjs-metric-value pjs-metric-value_up' : 'pjs-metric-value';
    }

    // Biggest leak = stage with largest drop count (excluding entry).
    get biggestLeak() {
        const stages = this.computedStages.slice(1);
        return stages.reduce((worst, s) => (s.dropCount > worst.dropCount ? s : worst), stages[0]);
    }

    get startingCohortDisplay() {
        return STARTING_COHORT.toLocaleString();
    }

    // ---- selected stage detail panel ---------------------------------------

    get selectedStage() {
        return this.computedStages.find((s) => s.key === this.selectedKey);
    }

    get selectedHasAction() {
        const s = this.selectedStage;
        return s && !!s.repAction;
    }

    // ---- lever display helpers ----------------------------------------------

    get displayLevers() {
        return this.levers.map((l) => {
            const active = l.value > 0;
            return {
                ...l,
                active,
                cardClass: `pjs-lever${active ? ' pjs-lever_active' : ''}`,
                valueLabel: active ? `${l.value}%` : 'Off'
            };
        });
    }

    get anyLeverActive() {
        return this.levers.some((l) => l.value > 0);
    }

    // ---- interaction handlers -----------------------------------------------

    handleStageClick(event) {
        this.selectedKey = event.currentTarget.dataset.key;
    }

    handleStageKey(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.selectedKey = event.currentTarget.dataset.key;
        }
    }

    handleLeverChange(event) {
        const key = event.target.dataset.key;
        const value = parseInt(event.target.value, 10);
        this.levers = this.levers.map((l) => (l.key === key ? { ...l, value } : l));
        // Focus the stage this lever affects so the impact is visible.
        const lever = LEVERS.find((l) => l.key === key);
        if (lever) this.selectedKey = lever.target;
    }

    handleReset() {
        this.levers = this.levers.map((l) => ({ ...l, value: 0 }));
    }

    handleMaximize() {
        this.levers = this.levers.map((l) => ({ ...l, value: 100 }));
    }
}
