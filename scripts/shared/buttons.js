/*
 * The buttons our scripts add to TransPoster's pages, in the application's own language.
 *
 * wwwroot/css/button.css dresses a matched pair with a single rule: `btn-blue` is filled
 * blue, `btn-white outline` is that same blue as an outline - the name is the fill, not the
 * ink - and `btn-mini` sizes either of them down. Views/Users/Index.cshtml sets the two side
 * by side with a FontAwesome icon in the filled one, which is the shape of what we add: a
 * button that produces a file, and a quieter one beside it that opens the part to be changed.
 *
 * Bootstrap's btn-dark and btn-outline-dark - what these buttons wore before - appear nowhere
 * in the application. They are near-black, and that is why our buttons read as a foreign body.
 *
 * FontAwesome 6.1.0 is loaded by Views/Shared/_Layout.cshtml on every page, so an icon costs
 * nothing to add. It paints in currentColor, so one markup serves the filled button and the
 * outlined one alike.
 */

const TP_BUTTON_STYLE_ID = 'tp-button-styles';

// The label sits in a span of its own so that the busy state can swap it without taking the
// icon with it - which is exactly what assigning to the button's textContent would do.
const TP_BUTTON_LABEL_CLASS = 'tp-btn-label';

const TP_BUTTON_ICON = {
    produce: 'fa-solid fa-download',
    edit: 'fa-solid fa-pencil',
};

const TP_BUTTON_CSS = `
    /* The icon and the label on one line. btn-blue and btn-white are ordinary buttons rather
       than flex ones, so the gap between the two has to be asked for. */
    .tp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .5ch;
        cursor: pointer;
        white-space: nowrap;
    }

    /* button.css dims .btn-primary:disabled and nothing else, so a disabled btn-blue would
       look no different from a live one - and these buttons disable themselves while they
       work. The same .4 the application dims its own buttons by. */
    .tp-btn:disabled {
        opacity: .4;
        cursor: default;
    }

    /* .btn-white:focus fills the button blue and lightens its text, which would leave the edit
       button looking like the produce button it exists to be told apart from. It opens the
       builder in a tab of its own, so it still holds the focus when you look back at this one.
       Held to the outline it was; the ring below is what says where the focus is. */
    button.tp-btn-outline:focus {
        background: var(--app-white, #FFFFFF);
        color: var(--app-blue, #5B92FF);
    }

    button.tp-btn-outline:focus-visible {
        outline: 2px solid var(--app-blue, #5B92FF);
        outline-offset: 1px;
    }
`;

/** An element, its class and its words - the three things every one of these scripts makes. */
function tpCreate(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
        node.className = className;
    }

    if (text != null) {
        node.textContent = text;
    }

    return node;
}

/** Adds a stylesheet to the page once, however many times the script asks for it. */
function tpInjectStyle(id, css) {
    if (document.getElementById(id)) {
        return;
    }

    const style = tpCreate('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
}

function tpButton(className, iconClass, label, title) {
    tpInjectStyle(TP_BUTTON_STYLE_ID, TP_BUTTON_CSS);

    const button = tpCreate('button', className);

    // These sit inside the page's own forms, and a button with no type submits them
    button.type = 'button';

    if (title) {
        button.title = title;
    }

    const icon = tpCreate('i', iconClass);
    icon.setAttribute('aria-hidden', 'true');

    button.append(icon, tpCreate('span', TP_BUTTON_LABEL_CLASS, label));

    return button;
}

/** Produces a file. The filled blue button, under the application's download icon. */
const tpProduceButton = (label, title) =>
    tpButton('btn-blue btn-mini tp-btn', TP_BUTTON_ICON.produce, label, title);

/** Opens a part to be changed. The same blue, outlined, so it is not the produce button. */
const tpEditButton = (label, title) =>
    tpButton('btn-white btn-mini outline tp-btn tp-btn-outline', TP_BUTTON_ICON.edit, label, title);

/** Where a button keeps its words: the label span, or the button itself if it has none. */
const tpButtonLabel = button => button.querySelector(`.${TP_BUTTON_LABEL_CLASS}`) ?? button;

const tpSetButtonLabel = (button, text) => {
    tpButtonLabel(button).textContent = text;
};

/**
 * Runs `job` with the button held busy - disabled, and saying what it is doing - and gives the
 * button back however the job ends. Whatever the job throws is thrown on, so that each page
 * can report a failure where its own readers will look for it.
 */
async function tpWhileBusy(button, busyText, job) {
    const label = tpButtonLabel(button).textContent;

    button.disabled = true;
    tpSetButtonLabel(button, busyText);

    try {
        return await job();
    } finally {
        button.disabled = false;
        tpSetButtonLabel(button, label);
    }
}
