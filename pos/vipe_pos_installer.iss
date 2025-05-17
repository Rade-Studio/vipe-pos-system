; -- vipe_pos_installer.iss --
#define AppName      "Vipe POS"
#define AppVersion   "1.0"
#define AppPublisher "TuNombre"
#define AppExeName   "vipe_pos.exe"
#define SrcDir       "dist\vipe_pos"  ; carpeta generada por PyInstaller

[Setup]
; Datos generales
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={pf}\{#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=VipePOS_Setup
Compression=lzma
SolidCompression=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; Copia todos los archivos de tu carpeta dist\vipe_pos
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
; Acceso directo en Menú Inicio
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
; Acceso directo en Escritorio
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
; Acceso directo en la carpeta “Inicio” para autoarranque
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

[Registry]
; Alternativa: crear clave Run en registro (HKCU) para autoarranque
; Uncomment si prefieres registro en vez de acceso directo en Startup
;Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
;     ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExeName}"""; \
;     Flags: uninsdeletevalue

[Run]
; Ejecutar app al terminar la instalación (opcional)
Filename: "{app}\{#AppExeName}"; Description: "Iniciar {#AppName} ahora"; Flags: nowait postinstall skipifsilent
