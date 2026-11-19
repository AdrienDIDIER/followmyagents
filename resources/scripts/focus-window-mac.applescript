-- Met au premier plan la fenêtre VS Code qui contient la session Claude Code.
-- Équivalent macOS de focus-window.ps1.
--
-- Usage  : osascript focus-window-mac.applescript "<chemin racine>" "<nom 1>" ["<nom 2>" …]
--   chemin racine : dossier de la fenêtre VS Code (lu dans ~/.claude/ide/*.lock) ou cwd
--   noms          : noms à chercher dans le titre, du plus probable au moins probable
-- Ordre de recherche :
--   1) un segment du titre (« fichier — dossier ») est exactement un des noms ;
--   2) le document représenté par la fenêtre (AXDocument, fichier actif) est dans le chemin racine ;
--   3) le titre contient un des noms.
-- Sortie : "FOCUSED <titre>" | "NOTFOUND" (VS Code ouvert, aucune fenêtre ne correspond)
--          | "NOAPP" (VS Code n'est pas lancé)
-- Erreur : -1719 / -25211 si FollowMyAgents n'a pas l'accès « Accessibilité ».

on run argv
	set rootPath to item 1 of argv
	set names to {}
	if (count of argv) > 1 then set names to items 2 thru -1 of argv
	tell application "System Events"
		set procs to (every application process whose (bundle identifier is "com.microsoft.VSCode" or bundle identifier is "com.microsoft.VSCodeInsiders"))
		if (count of procs) is 0 then return "NOAPP"
		set p to item 1 of procs
		set wins to every window of p
		set found to missing value
		-- 1) segment exact du titre
		repeat with n in names
			repeat with w in wins
				if my hasSegment(name of w as text, n as text) then
					set found to w
					exit repeat
				end if
			end repeat
			if found is not missing value then exit repeat
		end repeat
		-- 2) fichier actif de la fenêtre situé dans le dossier racine
		if found is missing value and rootPath is not "" then
			set rootUrl to my fileUrl(rootPath)
			repeat with w in wins
				try
					set doc to value of attribute "AXDocument" of w
					if doc is not missing value and (doc as text) starts with rootUrl then
						set found to w
						exit repeat
					end if
				end try
			end repeat
		end if
		-- 3) titre qui contient un des noms
		if found is missing value then
			repeat with n in names
				repeat with w in wins
					if (name of w as text) contains (n as text) then
						set found to w
						exit repeat
					end if
				end repeat
				if found is not missing value then exit repeat
			end repeat
		end if
		if found is missing value then return "NOTFOUND"
		try
			if value of attribute "AXMinimized" of found is true then set value of attribute "AXMinimized" of found to false
		end try
		perform action "AXRaise" of found
		set frontmost of p to true
		perform action "AXRaise" of found
		return "FOCUSED " & (name of found as text)
	end tell
end run

on hasSegment(t, target)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to {" — ", " - "}
	set parts to text items of t
	set AppleScript's text item delimiters to saved
	repeat with x in parts
		if (x as text) is target then return true
	end repeat
	return false
end hasSegment

-- "/Users/me/Mon Projet" → "file:///Users/me/Mon%20Projet/"
on fileUrl(p)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to " "
	set parts to text items of p
	set AppleScript's text item delimiters to "%20"
	set encoded to parts as text
	set AppleScript's text item delimiters to saved
	if encoded does not end with "/" then set encoded to encoded & "/"
	return "file://" & encoded
end fileUrl
