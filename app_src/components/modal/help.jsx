import React from 'react';
import {FiX} from "react-icons/fi";

import config from '../../config';
import {locale, openUrl} from '../../utils';
import {useContext} from '../../context';


const HelpModal = React.memo(function HelpModal() {
    const context = useContext();
    const close = () => {
        context.dispatch({type: 'setModal'});
    };
    const shortcutLabel = (shortcut) => Array.isArray(shortcut) && shortcut.length ? shortcut.join(' + ') : '-';
    const quickActions = [
        { label: locale.helpQuickPaste || 'Paste in selection', shortcut: shortcutLabel(context.state.shortcut.add), detail: locale.helpQuickPasteDescr || 'Creates a styled text layer in the current selection and advances to the next line.' },
        { label: locale.helpQuickApply || 'Apply to active layer', shortcut: shortcutLabel(context.state.shortcut.apply), detail: locale.helpQuickApplyDescr || 'Replaces the active text layer content and style with the current line and style.' },
        { label: locale.helpQuickAlign || 'Align active layer', shortcut: shortcutLabel(context.state.shortcut.center), detail: locale.helpQuickAlignDescr || 'Centers the active text layer in the current selection.' },
        { label: locale.helpQuickMultiBubble || 'Multi-bubble', shortcut: shortcutLabel(context.state.shortcut.toggleMultiBubble), detail: locale.helpQuickMultiBubbleDescr || 'Captures several selections, then inserts several text lines in one action.' },
        { label: locale.helpQuickNextPage || 'Next page', shortcut: shortcutLabel(context.state.shortcut.nextPage), detail: locale.helpQuickNextPageDescr || 'Jumps to the next Page marker in the pasted script.' },
        { label: locale.helpQuickMarkdown || 'Markdown paste', shortcut: locale.settingsTabBehavior || 'Behavior', detail: locale.helpQuickMarkdownDescr || 'Enable markdown to keep bold and italic markers when pasting formatted text.' },
    ];
    return (
        <React.Fragment>
            <div className="app-modal-header hostBrdBotContrast">
                <div className="app-modal-title">
                    {locale.helpTitle}
                </div>
                <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
                    <FiX size={18} />
                </button>
            </div>
            <div className="app-modal-body">
                <div className="app-modal-body-inner article-format"
                    dangerouslySetInnerHTML = {
                        { __html: locale.helpText}
                    }
                ></div>
                <div className="app-modal-body-inner article-format">
                    <h3>{locale.helpQuickTitle || 'Useful hidden features'}</h3>
                    <ul>
                        {quickActions.map((action) => (
                            <li key={action.label}>
                                <b>{action.label}</b> <span>({action.shortcut})</span> - {action.detail}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <div className="app-modal-footer hostBrdTopContrast">
                <span className="link" onClick={() => openUrl(config.appUrl)}><b>{config.appTitle}</b></span> ({locale.helpVersion}: {config.appVersion}){', '}
                {locale.helpAuthor} <span className="link" onClick={() => openUrl(config.authorUrl)}>{config.authorName}</span>
                {config.authorName2 ? (
                    <React.Fragment> & <span className="link" onClick={() => openUrl(config.authorUrl2)}>{config.authorName2}</span></React.Fragment>
                ) : null}
            </div>
        </React.Fragment>
    );
});

export default HelpModal;
