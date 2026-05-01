Option Explicit
Dim shell, fso, appDir, cmdFile, req, ready, edgePath, chromePath, browserCmd, fileItem
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdFile = ""

For Each fileItem In fso.GetFolder(appDir).Files
  If LCase(fso.GetExtensionName(fileItem.Name)) = "cmd" Then
    cmdFile = fileItem.ShortPath
    Exit For
  End If
Next

ready = False
On Error Resume Next
Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
req.Open "GET", "http://127.0.0.1:8787/api/agent", False
req.Send
If Err.Number = 0 Then
  If req.Status = 200 Then ready = True
End If
Err.Clear
On Error GoTo 0

If ready Then
  edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
  If fso.FileExists(edgePath) Then
    browserCmd = """" & edgePath & """ --new-window --kiosk http://127.0.0.1:8787/ --edge-kiosk-type=fullscreen"
  ElseIf fso.FileExists(chromePath) Then
    browserCmd = """" & chromePath & """ --new-window --kiosk http://127.0.0.1:8787/"
  Else
    browserCmd = "http://127.0.0.1:8787/"
  End If
  shell.Run browserCmd, 1, False
ElseIf cmdFile <> "" Then
  shell.Run "cmd /c """ & cmdFile & """", 0, False
End If
