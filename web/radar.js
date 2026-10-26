const TWO_PI = Math.PI * 2;
const SWEEP_CYCLE_MS = 12000;
const RADAR_CONTACT_LIMIT = 5;

export function drawRadar(ctx, width, height, data, theme, showLabels, now, selectedContactId = null, trackedContacts = []) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const radarRadius = Math.max(20, Math.min(width, height) * 0.43);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const rangeKm = Number(data?.range_km || 50);
  const contacts = contactsInRange(data, rangeKm);
  const visibleContacts = normalizeVisibleContacts(trackedContacts, contacts, rangeKm);
  const selectedContact = selectedContactId
    ? visibleContacts.find((contact) => contact.id === selectedContactId) || contacts.find((contact) => contact.id === selectedContactId)
    : visibleContacts[0];

  drawRings(ctx, centerX, centerY, radarRadius, rangeKm, theme);
  drawSweep(ctx, centerX, centerY, radarRadius, now, theme);
  drawContacts(ctx, centerX, centerY, radarRadius, rangeKm, visibleContacts, theme, showLabels, selectedContact?.id || null, now);

  if (!data || data.status === "starting") {
    drawCenterMessage(ctx, centerX, centerY, "STARTING", theme);
  } else if (visibleContacts.length === 0) {
    drawCenterMessage(ctx, centerX, centerY, "NO CONTACTS IN RANGE", theme);
  }
}

function contactsInRange(data, rangeKm) {
  const maxDisplay = Number(data?.filter?.max_display_contacts || 30);
  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  return contacts.filter((contact) => Number(contact.distance_km) <= rangeKm).slice(0, maxDisplay);
}

function normalizeVisibleContacts(trackedContacts, fallbackContacts, rangeKm) {
  const source = Array.isArray(trackedContacts) && trackedContacts.length > 0 ? trackedContacts : fallbackContacts;
  return source.filter((contact) => Number(contact.distance_km) <= rangeKm).slice(0, RADAR_CONTACT_LIMIT);
}

function drawRings(ctx, centerX, centerY, radius, rangeKm, theme) {
  ctx.save();
  ctx.strokeStyle = theme.gridDim;
  ctx.lineWidth = 1;

  for (let ring = 1; ring <= 4; ring += 1) {
    const ringRadius = (radius * ring) / 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, TWO_PI);
    ctx.stroke();
  }

  ctx.strokeStyle = theme.grid;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, TWO_PI);
  ctx.stroke();

  ctx.strokeStyle = theme.gridDim;
  ctx.beginPath();
  ctx.moveTo(centerX - radius, centerY);
  ctx.lineTo(centerX + radius, centerY);
  ctx.moveTo(centerX, centerY - radius);
  ctx.lineTo(centerX, centerY + radius);
  ctx.stroke();

  ctx.fillStyle = theme.text;
  ctx.font = "700 12px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", centerX, centerY - radius - 12);
  ctx.fillText("E", centerX + radius + 12, centerY);
  ctx.fillText("S", centerX, centerY + radius + 12);
  ctx.fillText("W", centerX - radius - 12, centerY);

  ctx.fillStyle = theme.grid;
  ctx.font = "600 10px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${Math.round(rangeKm / 2)} km`, centerX + 8, centerY - radius / 2);
  ctx.fillText(`${Math.round(rangeKm)} km`, centerX + 8, centerY - radius + 12);
  ctx.restore();
}

function drawSweep(ctx, centerX, centerY, radius, now, theme) {
  const sweepAngle = ((now % SWEEP_CYCLE_MS) / SWEEP_CYCLE_MS) * TWO_PI;
  const x = centerX + Math.sin(sweepAngle) * radius;
  const y = centerY - Math.cos(sweepAngle) * radius;

  ctx.save();
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, theme.sweep);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = theme.sweepFade;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, sweepAngle - 0.22, sweepAngle, -1);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.sweep;
  ctx.shadowColor = theme.sweep;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}

function drawContacts(ctx, centerX, centerY, radarRadius, rangeKm, contacts, theme, showLabels, selectedContactId, now) {
  const labelBoxes = [];

  contacts.forEach((contact, index) => {
    const point = projectContact(centerX, centerY, radarRadius, rangeKm, contact);
    const isGround = contact.on_ground === true;
    const isSelected = selectedContactId && contact.id === selectedContactId;
    const blipColor = isSelected ? theme.tracked : isGround ? theme.ground : theme.blip;
    const glowColor = isSelected ? theme.trackedGlow : isGround ? "transparent" : theme.blipGlow;

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = isSelected ? 14 : isGround ? 0 : 8;
    ctx.fillStyle = blipColor;
    ctx.strokeStyle = blipColor;

    if (isSelected) {
      drawSelectedBlip(ctx, point.x, point.y, now);
    } else if (isGround) {
      ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
    } else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, index < 10 ? 4 : 3, 0, TWO_PI);
      ctx.fill();
    }

    drawHeading(ctx, point.x, point.y, contact.heading_deg, blipColor);
    ctx.restore();

    if (isSelected && showLabels) {
      drawLabel(ctx, point.x, point.y, contactLabel(contact), theme, labelBoxes);
    }
  });
}

function drawSelectedBlip(ctx, x, y, now) {
  const pulse = 0.5 + Math.sin(now / 180) * 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 0.45 + pulse * 0.25;
  ctx.beginPath();
  ctx.arc(x, y, 10 + pulse * 4, 0, TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function projectContact(centerX, centerY, radarRadius, rangeKm, contact) {
  const rangeRatio = Number(contact.distance_km) / rangeKm;
  const angle = (Number(contact.bearing_deg) * Math.PI) / 180;

  return {
    x: centerX + Math.sin(angle) * rangeRatio * radarRadius,
    y: centerY - Math.cos(angle) * rangeRatio * radarRadius,
  };
}

function drawHeading(ctx, x, y, headingDeg, color) {
  if (headingDeg === null || headingDeg === undefined) {
    return;
  }

  const heading = (Number(headingDeg) * Math.PI) / 180;
  const length = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.sin(heading) * length, y - Math.cos(heading) * length);
  ctx.stroke();
}

function drawLabel(ctx, x, y, text, theme, labelBoxes) {
  if (!text) {
    return;
  }

  ctx.save();
  ctx.font = "700 11px Segoe UI, Arial, sans-serif";
  const width = Math.ceil(ctx.measureText(text).width) + 8;
  const height = 18;
  const box = { x: x + 8, y: y - 22, width, height };

  if (labelBoxes.some((existing) => overlaps(existing, box))) {
    ctx.restore();
    return;
  }

  labelBoxes.push(box);
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.strokeStyle = theme.gridDim;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.fillStyle = theme.labelColor;
  ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + 4, box.y + height / 2);
  ctx.restore();
}

function drawCenterMessage(ctx, centerX, centerY, text, theme) {
  ctx.save();
  ctx.fillStyle = theme.warning;
  ctx.font = "800 15px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, centerX, centerY);
  ctx.restore();
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contactLabel(contact) {
  return contact.callsign || contact.id || "";
}
