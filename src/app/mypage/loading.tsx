import "./mypage.css";

export default function MypageLoading() {
  return (
    <div className="mypage-shell" aria-busy="true" aria-live="polite">
      <div className="mypage-skel-rail" aria-hidden="true" />
      <aside className="mypage-menu" aria-hidden="true">
        <div className="mypage-skel-line" style={{ width: 150, height: 16, margin: "4px 8px 22px" }} />
        <div className="mypage-skel-line" style={{ height: 64, borderRadius: 14 }} />
        <div className="mypage-skel-line" style={{ width: 40, height: 11, margin: "24px 8px 10px" }} />
        <div className="mypage-menu-list">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="mypage-skel-line" style={{ height: 46 }} />
          ))}
        </div>
      </aside>
      <div className="mypage-content">
        <div className="mypage-progress" role="progressbar" aria-label="마이페이지 정보를 불러오는 중">
          <span />
        </div>
        <div className="mypage-title">
          <div>
            <div className="mypage-skel-line" style={{ width: 110, height: 12 }} />
            <div className="mypage-skel-line" style={{ width: 220, height: 32, marginTop: 12 }} />
            <div className="mypage-skel-line" style={{ width: 340, height: 15, marginTop: 12 }} />
          </div>
        </div>
        <div className="mypage-card" aria-hidden="true">
          <div className="mypage-skel-line" style={{ width: 180, height: 18 }} />
          <div className="mypage-form-grid" style={{ paddingTop: 24 }}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}>
                <div className="mypage-skel-line" style={{ width: 80, height: 12, marginBottom: 8 }} />
                <div className="mypage-skel-line" style={{ width: "100%", height: 46 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
