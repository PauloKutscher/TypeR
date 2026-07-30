import './modal.scss';

import React from 'react';
import {useContext} from '../../context';
import {locale} from '../../utils';

const HelpModal = React.lazy(() => import(/* webpackChunkName: "modal-help" */ './help'));
const WalkthroughModal = React.lazy(() => import(/* webpackChunkName: "modal-walkthrough" */ './walkthrough'));
const SettingsModal = React.lazy(() => import(/* webpackChunkName: "modal-settings" */ './settings'));
const EditStyleModal = React.lazy(() => import(/* webpackChunkName: "modal-edit-style" */ './editStyle'));
const EditFolderModal = React.lazy(() => import(/* webpackChunkName: "modal-edit-folder" */ './editFolder'));
const ExportModal = React.lazy(() => import(/* webpackChunkName: "modal-export" */ './export'));
const FontScanRModal = React.lazy(() => import(/* webpackChunkName: "modal-font-scan" */ './fontScanR'));
const UpdateModal = React.lazy(() => import(/* webpackChunkName: "modal-update" */ './update'));

class ModalErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {hasError: false};
    }

    static getDerivedStateFromError() {
        return {hasError: true};
    }

    componentDidUpdate(prevProps) {
        if (prevProps.modalType !== this.props.modalType && this.state.hasError) {
            this.setState({hasError: false});
        }
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        return (
            <React.Fragment>
                <div className="app-modal-header hostBrdBotContrast">
                    <div className="app-modal-title">{locale.errorTitle}</div>
                </div>
                <div className="app-modal-body">
                    <div className="app-modal-body-inner article-format">
                        <p>{locale.modalLoadError || 'Unable to load this window. Please close and reopen TypeR.'}</p>
                    </div>
                </div>
                <div className="app-modal-footer hostBrdTopContrast">
                    <button className="topcoat-button--large" onClick={this.props.onClose}>{locale.close}</button>
                </div>
            </React.Fragment>
        );
    }
}

const Modal = React.memo(function Modal() {
    const context = useContext();
    const close = React.useCallback(() => {
        context.dispatch({type: 'setModal'});
    }, [context.dispatch]);

    let modalContent = null;
    let modalType = context.state.modalType;
    if (modalType === 'help') modalContent = <HelpModal />;
    else if (modalType === 'walkthrough') modalContent = <WalkthroughModal />;
    else if (modalType === 'settings') modalContent = <SettingsModal />;
    else if (modalType === 'editStyle') modalContent = <EditStyleModal />;
    else if (modalType === 'editFolder') modalContent = <EditFolderModal />;
    else if (modalType === 'export') modalContent = <ExportModal />;
    else if (modalType === 'fontScanR') modalContent = <FontScanRModal />;
    else if (modalType === 'update') modalContent = <UpdateModal />;

    React.useEffect(() => {
        if (!context.state.notFirstTime) {
            context.dispatch({type: 'showFirstRunWalkthrough'});
        }
    }, []);

    return modalContent ? (
        <div className={`app-modal${modalType === 'walkthrough' ? ' app-modal--walkthrough' : ''}`}>
            {modalType !== 'walkthrough' && <div className="app-modal-hatch hostBgd"></div>}
            <div className={`app-modal-inner hostBgdLight${modalType === 'walkthrough' ? ' app-modal-inner--walkthrough' : ''}`}>
                <ModalErrorBoundary modalType={modalType} onClose={close}>
                    <React.Suspense fallback={<div className="app-modal-body"><div className="app-modal-body-inner">{locale.loading || 'Loading...'}</div></div>}>
                        {modalContent}
                    </React.Suspense>
                </ModalErrorBoundary>
            </div>
        </div>
    ) : null;
});

export default Modal;
