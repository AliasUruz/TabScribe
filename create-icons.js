// Crie um arquivo HTML com o SVG abaixo e use-o para gerar os ícones
// depois de abrir no navegador, faça uma captura de tela e salve nos tamanhos necessários

const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Gerador de Ícones TabScribe</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #f0f0f0;
      font-family: Arial, sans-serif;
    }
    
    .icon-container {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      justify-content: center;
      margin-top: 20px;
    }
    
    .icon-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    
    .icon {
      background: #3d85c6;
      border-radius: 8px;
      padding: 10px;
      display: flex;
      justify-content: center;
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    
    .icon-16 {
      width: 16px;
      height: 16px;
    }
    
    .icon-32 {
      width: 32px;
      height: 32px;
    }
    
    .icon-48 {
      width: 48px;
      height: 48px;
    }
    
    .icon-128 {
      width: 128px;
      height: 128px;
    }
    
    h1 {
      margin-bottom: 30px;
      color: #333;
    }
    
    p {
      margin-top: 5px;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>Ícones para TabScribe</h1>
  
  <div class="icon-container">
    <div class="icon-wrapper">
      <div class="icon icon-16">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 9H11C9.89543 9 9 9.89543 9 11V20C9 21.1046 9.89543 22 11 22H20C21.1046 22 22 21.1046 22 20V11C22 9.89543 21.1046 9 20 9Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p>16x16</p>
    </div>
    
    <div class="icon-wrapper">
      <div class="icon icon-32">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 9H11C9.89543 9 9 9.89543 9 11V20C9 21.1046 9.89543 22 11 22H20C21.1046 22 22 21.1046 22 20V11C22 9.89543 21.1046 9 20 9Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p>32x32</p>
    </div>
    
    <div class="icon-wrapper">
      <div class="icon icon-48">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 9H11C9.89543 9 9 9.89543 9 11V20C9 21.1046 9.89543 22 11 22H20C21.1046 22 22 21.1046 22 20V11C22 9.89543 21.1046 9 20 9Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p>48x48</p>
    </div>
    
    <div class="icon-wrapper">
      <div class="icon icon-128">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 9H11C9.89543 9 9 9.89543 9 11V20C9 21.1046 9.89543 22 11 22H20C21.1046 22 22 21.1046 22 20V11C22 9.89543 21.1046 9 20 9Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p>128x128</p>
    </div>
  </div>
  
  <h2>Instruções:</h2>
  <ul>
    <li>Capture a tela de cada ícone individualmente</li>
    <li>Salve como PNG</li>
    <li>Utilize os tamanhos corretos: 16x16, 32x32, 48x48 e 128x128</li>
    <li>Coloque os arquivos na pasta 'icons' com os nomes: icon16.png, icon32.png, icon48.png e icon128.png</li>
  </ul>
</body>
</html>
`;

console.log(html); 