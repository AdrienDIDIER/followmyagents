-- Met au premier plan la fenêtre VS Code dont le titre contient le nom du dossier.
-- Équivalent macOS de focus-window.ps1.
--
-- Usage  : osascript focus-window-mac.applescript "<nom du dossier>"
-- Sortie : "FOCUSED <titre>" | "NOTFOUND" (VS Code ouvert, pas de fenêtre pour ce dossier)
--          | "NOAPP" (VS Code n'est pas lancé)
-- Erreur : -1719 / -25211 si FollowMyAgents n'a pas l'accès « Accessibilité ».
--
-- Titre par défaut d'une fenêtre VS Code sur macOS : « fichier — dossier ».

on run argv
	set target to item 1 of argv
	tell application "System Events"
		set procs to (every application process whose (bundle identifier is "com.microsoft.VSCode" or bundle identifier is "com.microsoft.VSCodeInsiders"))
		if (count of procs) is 0 then return "NOAPP"
		set p to item 1 of procs
		set wins to every window of p
		set found to missing value
		-- 1) segment exact du titre (« … — dossier »)
		repeat with w in wins
			if my hasSegment(name of w as text, target) then
				set found to w
				exit repeat
			end if
		end repeat
		-- 2) titre qui contient le nom du dossier
		if found is missing value then
			repeat with w in wins
				if (name of w as text) contains target then
					set found to w
					exit repeat
				end if
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
