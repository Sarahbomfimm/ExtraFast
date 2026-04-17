import '../styles/HomePage.css';

export function HomePage() {
  return (
    <div className="home-page">
      <main className="home-content">
        <div className="empty-state">
          <div className="empty-icon"></div>
          <h2></h2>
          <p>Selecione uma opção na barra lateral para começar</p>
        </div>
      </main>
    </div>
  );
}
