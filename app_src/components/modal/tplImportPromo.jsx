import React from 'react';
import { FaFileImport } from 'react-icons/fa';
import { locale } from '../../utils';

const TplImportPromo = React.memo(function TplImportPromo({ onImportTpl }) {
  return (
    <div className="fsr-promo hostBgd">
      <div className="fsr-promo-text">
        <b>
          {locale.tplImportTitle}
          <em className="fsr-promo-badge">{locale.badgeNew}</em>
        </b>
        <span>{locale.tplImportPromo}</span>
      </div>
      <button type="button" className="topcoat-button--large fsr-promo-btn" onClick={onImportTpl}>
        <FaFileImport size={16} /> {locale.tplImportOpen}
      </button>
    </div>
  );
});

export default TplImportPromo;
