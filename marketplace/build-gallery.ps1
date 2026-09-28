Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$outDir = Join-Path $root "marketplace"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Color([int]$r, [int]$g, [int]$b) {
	return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

$bg = Color 13 15 20
$panel = Color 26 29 36
$field = Color 42 47 58
$track = Color 58 64 78
$white = Color 244 246 248
$muted = Color 168 176 189
$blue = Color 61 126 255
$blueDeep = Color 37 86 214

function New-Canvas {
	$bitmap = New-Object System.Drawing.Bitmap 1920, 960
	$bitmap.SetResolution(144, 144)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
	$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
	$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
	$graphics.Clear($bg)
	return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Round-Rect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$d = $r * 2
	$path.AddArc($x, $y, $d, $d, 180, 90)
	$path.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
	$path.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
	$path.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
	$path.CloseFigure()
	return $path
}

function Fill-Round($graphics, $color, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
	$path = Round-Rect $x $y $w $h $r
	$brush = New-Object System.Drawing.SolidBrush $color
	$graphics.FillPath($brush, $path)
	$brush.Dispose()
	$path.Dispose()
}

function Draw-Dial($graphics, [single]$cx, [single]$cy, [single]$radius) {
	$brush = New-Object System.Drawing.SolidBrush $blue
	$graphics.FillEllipse($brush, ($cx - $radius), ($cy - $radius), ($radius * 2), ($radius * 2))
	$brush.Dispose()
	$pen = New-Object System.Drawing.Pen $white, ($radius * 0.12)
	$inner = $radius * 0.62
	$graphics.DrawEllipse($pen, ($cx - $inner), ($cy - $inner), ($inner * 2), ($inner * 2))
	$pen.Dispose()
	$dot = New-Object System.Drawing.SolidBrush $white
	$dotR = $radius * 0.16
	$graphics.FillEllipse($dot, ($cx - $dotR), ($cy - $dotR), ($dotR * 2), ($dotR * 2))
	$dot.Dispose()
}

function Draw-Slider($graphics, [single]$x, [single]$y, [single]$w, [single]$value) {
	$trackH = 8
	$trackY = $y + 10
	Fill-Round $graphics $track $x $trackY $w $trackH 4
	$fillW = [Math]::Max(18, $w * $value)
	Fill-Round $graphics $blue $x $trackY $fillW $trackH 4
	$knob = 22
	$kx = $x + $fillW - ($knob / 2)
	$brush = New-Object System.Drawing.SolidBrush $white
	$graphics.FillEllipse($brush, $kx, ($trackY - 7), $knob, $knob)
	$brush.Dispose()
}

function Draw-Chevron($graphics, [single]$x, [single]$y) {
	$pen = New-Object System.Drawing.Pen $muted, 2.4
	$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
	$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
	$graphics.DrawLines($pen, @(
		(New-Object System.Drawing.PointF ($x), ($y)),
		(New-Object System.Drawing.PointF ($x + 7), ($y + 7)),
		(New-Object System.Drawing.PointF ($x + 14), ($y))
	))
	$pen.Dispose()
}

function Draw-CenteredLine($graphics, $text, $font, $brush, [single]$x, [single]$y, [single]$w, [single]$h) {
	$format = New-Object System.Drawing.StringFormat
	$format.Alignment = [System.Drawing.StringAlignment]::Near
	$format.LineAlignment = [System.Drawing.StringAlignment]::Center
	$format.Trimming = [System.Drawing.StringTrimming]::None
	$format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
	$rect = New-Object System.Drawing.RectangleF $x, $y, $w, $h
	$graphics.DrawString($text, $font, $brush, $rect, $format)
	$format.Dispose()
}

function Draw-Field($graphics, $labelFont, $valueFont, $labelBrush, $valueBrush, [string]$label, [string]$value, [single]$x, [single]$y, [single]$w, [bool]$dropdown) {
	$row = 52
	Draw-CenteredLine $graphics $label $labelFont $labelBrush $x $y 340 $row
	$boxX = $x + 360
	$boxW = $w - 360
	Fill-Round $graphics $field $boxX $y $boxW $row 10
	$textW = $(if ($dropdown) { $boxW - 64 } else { $boxW - 36 })
	Draw-CenteredLine $graphics $value $valueFont $valueBrush ($boxX + 18) $y $textW $row
	if ($dropdown) {
		Draw-Chevron $graphics ($boxX + $boxW - 36) ($y + 22)
	}
}

function Draw-Settings($graphics, [single]$x, [single]$y, [single]$w, [single]$h) {
	Fill-Round $graphics $panel $x $y $w $h 28
	$labelFont = New-Object System.Drawing.Font "Segoe UI", 18, ([System.Drawing.FontStyle]::Regular)
	$valueFont = New-Object System.Drawing.Font "Segoe UI", 18, ([System.Drawing.FontStyle]::Regular)
	$labelBrush = New-Object System.Drawing.SolidBrush $muted
	$valueBrush = New-Object System.Drawing.SolidBrush $white
	$left = $x + 36
	$width = $w - 72
	Draw-Field $graphics $labelFont $valueFont $labelBrush $valueBrush "Title" "Elgato" $left ($y + 36) $width $false
	Draw-Field $graphics $labelFont $valueFont $labelBrush $valueBrush "Output A" "Elgato XLR Dock MK.2" $left ($y + 112) $width $true
	Draw-CenteredLine $graphics "Output A step (%)" $labelFont $labelBrush $left ($y + 184) 340 52
	Draw-Slider $graphics ($left + 360) ($y + 196) ($width - 360) 0.62
	Draw-Field $graphics $labelFont $valueFont $labelBrush $valueBrush "Output B" "Speakers" $left ($y + 268) $width $true
	Draw-CenteredLine $graphics "Output B step (%)" $labelFont $labelBrush $left ($y + 340) 340 52
	Draw-Slider $graphics ($left + 360) ($y + 352) ($width - 360) 0.18
	Draw-Field $graphics $labelFont $valueFont $labelBrush $valueBrush "Level meter" "Stereo bars" $left ($y + 424) $width $true
	$labelFont.Dispose()
	$valueFont.Dispose()
	$labelBrush.Dispose()
	$valueBrush.Dispose()
}

function Save-Canvas($canvas, [string]$name) {
	$path = Join-Path $outDir $name
	$canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
	$canvas.Graphics.Dispose()
	$canvas.Bitmap.Dispose()
	Write-Output $path
}

function Draw-InkLeft($graphics, [string]$text, $font, $brush, [single]$inkX, [single]$y) {
	$format = New-Object System.Drawing.StringFormat ([System.Drawing.StringFormat]::GenericTypographic)
	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$em = $font.Size * $graphics.DpiY / 72
	$path.AddString($text.Substring(0, 1), $font.FontFamily, [int]$font.Style, $em, (New-Object System.Drawing.PointF 0, $y), $format)
	$glyphX = $path.GetBounds().Left
	$path.Dispose()
	$graphics.DrawString($text, $font, $brush, ($inkX - $glyphX), $y, $format)
	$format.Dispose()
}

# Thumbnail
$thumb = New-Canvas
$g = $thumb.Graphics
$textX = 64
Draw-Dial $g 132 250 54
$kicker = New-Object System.Drawing.Font "Segoe UI", 18, ([System.Drawing.FontStyle]::Bold)
$kickerBrush = New-Object System.Drawing.SolidBrush $blue
Draw-InkLeft $g "WAVE LINK" $kicker $kickerBrush $textX 360
$title = New-Object System.Drawing.Font "Segoe UI", 64, ([System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush $white
Draw-InkLeft $g "Better Audio" $title $titleBrush $textX 408
$body = New-Object System.Drawing.Font "Segoe UI", 24, ([System.Drawing.FontStyle]::Regular)
$bodyBrush = New-Object System.Drawing.SolidBrush $muted
Draw-InkLeft $g "Main output volume, two outputs," $body $bodyBrush $textX 560
Draw-InkLeft $g "and a live level meter." $body $bodyBrush $textX 608
Draw-Settings $g 900 140 960 680
Save-Canvas $thumb "thumbnail.png"
$kicker.Dispose(); $kickerBrush.Dispose(); $title.Dispose(); $titleBrush.Dispose(); $body.Dispose(); $bodyBrush.Dispose()

# Gallery 1: the settings screen
$one = New-Canvas
$g = $one.Graphics
$heading = New-Object System.Drawing.Font "Segoe UI", 42, ([System.Drawing.FontStyle]::Bold)
$headingBrush = New-Object System.Drawing.SolidBrush $white
$g.DrawString("Choose the outputs", $heading, $headingBrush, 80, 48)
$sub = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Regular)
$subBrush = New-Object System.Drawing.SolidBrush $muted
$g.DrawString("Output A and Output B, a step size for each, and the meter style.", $sub, $subBrush, 84, 150)
Draw-Settings $g 250 240 1420 660
Save-Canvas $one "gallery-1.png"
$heading.Dispose(); $headingBrush.Dispose(); $sub.Dispose(); $subBrush.Dispose()

# Gallery 2: three behaviors
$two = New-Canvas
$g = $two.Graphics
$heading = New-Object System.Drawing.Font "Segoe UI", 42, ([System.Drawing.FontStyle]::Bold)
$headingBrush = New-Object System.Drawing.SolidBrush $white
$g.DrawString("The dial", $heading, $headingBrush, 80, 48)
$sub = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Regular)
$subBrush = New-Object System.Drawing.SolidBrush $muted
$g.DrawString("Volume stays on the Wave Link main output.", $sub, $subBrush, 84, 150)

$cards = @(
	@{ Title = "Rotate"; Body = "Change the volume by 1 to 10 percent on each tick." },
	@{ Title = "Press"; Body = "Switch between Output A and Output B." },
	@{ Title = "Touch"; Body = "Refresh the output. The meter is an arc or stereo bars." }
)
$cardTitle = New-Object System.Drawing.Font "Segoe UI", 32, ([System.Drawing.FontStyle]::Bold)
$cardBody = New-Object System.Drawing.Font "Segoe UI", 20, ([System.Drawing.FontStyle]::Regular)
$cardX = 80
foreach ($card in $cards) {
	Fill-Round $g $panel $cardX 240 560 560 28
	Draw-Dial $g ($cardX + 90) 360 42
	$g.DrawString($card.Title, $cardTitle, $headingBrush, ($cardX + 48), 450)
	$rect = New-Object System.Drawing.RectangleF ($cardX + 48), 530, 460, 200
	$g.DrawString($card.Body, $cardBody, $subBrush, $rect)
	$cardX += 600
}
Save-Canvas $two "gallery-2.png"
$heading.Dispose(); $headingBrush.Dispose(); $sub.Dispose(); $subBrush.Dispose(); $cardTitle.Dispose(); $cardBody.Dispose()

# Gallery 3: independent steps
$three = New-Canvas
$g = $three.Graphics
$heading = New-Object System.Drawing.Font "Segoe UI", 42, ([System.Drawing.FontStyle]::Bold)
$headingBrush = New-Object System.Drawing.SolidBrush $white
$g.DrawString("A step size for each output", $heading, $headingBrush, 80, 48)
$sub = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Regular)
$subBrush = New-Object System.Drawing.SolidBrush $muted
$g.DrawString("One tick can be a small nudge on speakers and a larger jump on the dock.", $sub, $subBrush, 84, 150)

Fill-Round $g $panel 160 250 760 520 28
Fill-Round $g $panel 1000 250 760 520 28
$label = New-Object System.Drawing.Font "Segoe UI", 20, ([System.Drawing.FontStyle]::Regular)
$name = New-Object System.Drawing.Font "Segoe UI", 28, ([System.Drawing.FontStyle]::Bold)
$big = New-Object System.Drawing.Font "Segoe UI", 72, ([System.Drawing.FontStyle]::Bold)
$g.DrawString("OUTPUT A", $label, $subBrush, 210, 300)
$g.DrawString("Elgato XLR Dock MK.2", $name, $headingBrush, 210, 348)
$g.DrawString("6%", $big, $headingBrush, 210, 450)
$g.DrawString("per tick", $label, $subBrush, 210, 620)
Draw-Slider $g 210 690 640 0.62

$g.DrawString("OUTPUT B", $label, $subBrush, 1050, 300)
$g.DrawString("Speakers", $name, $headingBrush, 1050, 348)
$g.DrawString("2%", $big, $headingBrush, 1050, 450)
$g.DrawString("per tick", $label, $subBrush, 1050, 620)
Draw-Slider $g 1050 690 640 0.18
Save-Canvas $three "gallery-3.png"
$heading.Dispose(); $headingBrush.Dispose(); $sub.Dispose(); $subBrush.Dispose(); $label.Dispose(); $name.Dispose(); $big.Dispose()

function Draw-LayoutText($graphics, [string]$text, [single]$size, [string]$align, [single]$x, [single]$y, [single]$w, [single]$h, $brushColor) {
	$font = New-Object System.Drawing.Font "Segoe UI", ($size * 0.75), ([System.Drawing.FontStyle]::Bold)
	$format = New-Object System.Drawing.StringFormat
	$format.Alignment = $(if ($align -eq "right") { [System.Drawing.StringAlignment]::Far } else { [System.Drawing.StringAlignment]::Near })
	$format.LineAlignment = [System.Drawing.StringAlignment]::Center
	$format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
	$brush = New-Object System.Drawing.SolidBrush $brushColor
	$graphics.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF $x, $y, $w, $h), $format)
	$brush.Dispose()
	$format.Dispose()
	$font.Dispose()
}

function Add-MeterDonut($path, [single]$sweepPortion) {
	$start = -65
	$sweep = 130 * $sweepPortion
	$path.AddArc((49 - 47), (49 - 47), 94, 94, ($start - 90), $sweep)
	$path.AddArc((49 - 43), (49 - 43), 86, 86, (($start + $sweep) - 90), (-$sweep))
	$path.CloseFigure()
}

function Draw-LevelFill($graphics, [single]$x, [single]$y, [single]$w, [single]$h, [single]$portion, [single]$radius) {
	Fill-Round $graphics ([System.Drawing.Color]::FromArgb(115, 0, 0, 0)) $x $y $w $h $radius
	$fillW = $w * $portion
	if ($fillW -le 0) {
		return
	}
	$state = $graphics.Save()
	$graphics.SetClip((Round-Rect $x $y $fillW $h $radius))
	$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
		(New-Object System.Drawing.PointF $x, $y),
		(New-Object System.Drawing.PointF ($x + $w), $y),
		(Color 59 180 85),
		(Color 255 60 78)
	)
	$blend = New-Object System.Drawing.Drawing2D.ColorBlend 5
	$blend.Colors = @((Color 59 180 85), (Color 59 180 85), (Color 251 219 0), (Color 255 60 78), (Color 255 60 78))
	$blend.Positions = @(0, 0.6, 0.8, 0.95, 1)
	$gradient.InterpolationColors = $blend
	$graphics.FillRectangle($gradient, $x, $y, $w, $h)
	$gradient.Dispose()
	$graphics.Restore($state)
}

function Draw-Encoder($graphics, [string]$style) {
	Fill-Round $graphics (Color 44 44 44) 4 4 192 92 12
	Draw-LayoutText $graphics "Speakers" 15 "left" 16 8 168 22 $white
	Draw-LayoutText $graphics "64" 20 "right" $(if ($style -eq "bars") { 136 } else { 132 }) $(if ($style -eq "bars") { 38 } else { 40 }) $(if ($style -eq "bars") { 48 } else { 52 }) $(if ($style -eq "bars") { 22 } else { 24 }) $white
	Draw-LayoutText $graphics "%" 13 "right" 148 66 36 16 $white

	if ($style -eq "bars") {
		$dim = Color 189 189 189
		Draw-LayoutText $graphics "L" 12 "left" 16 40 16 16 $dim
		Draw-LayoutText $graphics "R" 12 "left" 16 62 16 16 $dim
		Draw-LevelFill $graphics 36 42 96 12 0.72 2
		Draw-LevelFill $graphics 36 64 96 12 0.38 2
		Fill-Round $graphics ([System.Drawing.Color]::FromArgb(64, 255, 255, 255)) 36 84 96 4 1
		Fill-Round $graphics $white 36 84 61 4 1
		return
	}

	$tickPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(89, 255, 255, 255)), 1.5
	$tickPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
	$tickPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
	foreach ($tick in @(
		@(30.36, 41, 24.3, 37.5), @(34.36, 35.29, 29, 30.79), @(39.29, 30.36, 34.79, 25),
		@(45, 26.36, 41.5, 20.3), @(51.32, 23.41, 48.93, 16.83), @(58.05, 21.61, 56.84, 14.71),
		@(65, 21, 65, 14), @(71.95, 21.61, 73.16, 14.71), @(78.68, 23.41, 81.07, 16.83),
		@(85, 26.36, 88.5, 20.3), @(90.71, 30.36, 95.21, 25), @(95.64, 35.29, 101, 30.79),
		@(99.64, 41, 105.7, 37.5)
	)) {
		$graphics.DrawLine($tickPen, (16 + $tick[0]), (44 + $tick[1]), (16 + $tick[2]), (44 + $tick[3]))
	}
	$tickPen.Dispose()

	$state = $graphics.Save()
	$graphics.TranslateTransform(32, 56)
	$graphics.SetClip((New-Object System.Drawing.RectangleF 0, 0, 98, 40))
	$trackPath = New-Object System.Drawing.Drawing2D.GraphicsPath
	Add-MeterDonut $trackPath 1
	$trackBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(115, 0, 0, 0))
	$graphics.FillPath($trackBrush, $trackPath)
	$trackBrush.Dispose()
	$trackPath.Dispose()
	$meterPath = New-Object System.Drawing.Drawing2D.GraphicsPath
	Add-MeterDonut $meterPath 0.48
	$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
		(New-Object System.Drawing.PointF 6, 20),
		(New-Object System.Drawing.PointF 92, 20),
		(Color 59 180 85),
		(Color 255 60 78)
	)
	$colorBlend = New-Object System.Drawing.Drawing2D.ColorBlend 5
	$colorBlend.Colors = @((Color 59 180 85), (Color 59 180 85), (Color 251 219 0), (Color 255 60 78), (Color 255 60 78))
	$colorBlend.Positions = @(0, 0.6, 0.8, 0.95, 1)
	$gradient.InterpolationColors = $colorBlend
	$graphics.FillPath($gradient, $meterPath)
	$gradient.Dispose()
	$meterPath.Dispose()
	$graphics.Restore($state)

	$needle = $graphics.Save()
	$graphics.TranslateTransform(45, 69)
	$graphics.TranslateTransform(36, 36)
	$graphics.RotateTransform(16.8)
	$graphics.TranslateTransform(-36, -36)
	Fill-Round $graphics $white 35 2 2 10 1
	$graphics.Restore($needle)
}

function New-EncoderBitmap([string]$style, [single]$scale) {
	$bitmap = New-Object System.Drawing.Bitmap ([int](200 * $scale)), ([int](100 * $scale))
	$bitmap.SetResolution(96, 96)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
	$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
	$graphics.Clear([System.Drawing.Color]::Transparent)
	$graphics.ScaleTransform($scale, $scale)
	Draw-Encoder $graphics $style
	$graphics.Dispose()
	return $bitmap
}

$arcDial = New-EncoderBitmap "arc" 9.6
$arcPath = Join-Path $outDir "gallery-dial.png"
$arcDial.Save($arcPath, [System.Drawing.Imaging.ImageFormat]::Png)
$arcDial.Dispose()
Write-Output $arcPath

$barsDial = New-EncoderBitmap "bars" 9.6
$barsPath = Join-Path $outDir "gallery-dial-bars.png"
$barsDial.Save($barsPath, [System.Drawing.Imaging.ImageFormat]::Png)
$barsDial.Dispose()
Write-Output $barsPath

$examples = New-Canvas
$eg = $examples.Graphics
$exampleTitle = New-Object System.Drawing.Font "Segoe UI", 28, ([System.Drawing.FontStyle]::Bold)
$exampleBrush = New-Object System.Drawing.SolidBrush $white
$eg.DrawString("Arc", $exampleTitle, $exampleBrush, 120, 200)
$eg.DrawString("Stereo bars", $exampleTitle, $exampleBrush, 1040, 200)
$arcExample = New-EncoderBitmap "arc" 4.2
$barsExample = New-EncoderBitmap "bars" 4.2
$eg.DrawImage($arcExample, 80, 280, 840, 420)
$eg.DrawImage($barsExample, 1000, 280, 840, 420)
$arcExample.Dispose()
$barsExample.Dispose()
$exampleTitle.Dispose()
$exampleBrush.Dispose()
Save-Canvas $examples "gallery-4.png"

# App icon, 288 x 288
$icon = New-Object System.Drawing.Bitmap 288, 288
$icon.SetResolution(144, 144)
$ig = [System.Drawing.Graphics]::FromImage($icon)
$ig.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$ig.Clear((Color 16 18 24))
Draw-Dial $ig 144 144 108
$iconPath = Join-Path $outDir "app-icon.png"
$icon.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$ig.Dispose()
$icon.Dispose()
Write-Output $iconPath
