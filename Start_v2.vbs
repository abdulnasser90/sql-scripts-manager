Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Launch node server completely hidden (0 = hidden window)
WshShell.Run "node server.js", 0, False

' Wait 1 second for server to start
WScript.Sleep 1000

' Open default browser
WshShell.Run "cmd /c start http://localhost:3000", 0, False
