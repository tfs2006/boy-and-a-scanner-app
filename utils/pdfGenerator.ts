
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TripResult } from '../types';

export const generateTripPDF = (trip: TripResult) => {
    const doc = new jsPDF();

    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 297, 'F');

    // Header
    doc.setTextColor(255, 255, 255);
    doc.setFont('courier', 'bold');
    doc.setFontSize(22);
    doc.text("BOY & A SCANNER // TRIP PLAN", 14, 20);

    doc.setFontSize(12);
    doc.setTextColor(34, 211, 238); // Cyan-400
    doc.text(`${trip.startLocation} -> ${trip.endLocation}`, 14, 30);

    let yPos = 40;

    trip.locations.forEach((loc) => {
        // Check if we need a new page
        if (yPos > 250) {
            doc.addPage();
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, 210, 297, 'F');
            yPos = 20;
        }

        // Location Header
        doc.setFontSize(16);
        doc.setTextColor(251, 191, 36); // Amber-400
        doc.text(`LOCATION: ${loc.locationName}`, 14, yPos);
        yPos += 8;

        // Conventional Frequencies
        const convRows = loc.data.agencies.flatMap(agency =>
            agency.frequencies.map(f => [
                agency.name,
                f.freq,
                f.tone || f.nac || f.colorCode || 'CSQ',
                f.mode,
                f.alphaTag || f.tag,
                f.description
            ])
        );

        if (convRows.length > 0) {
            doc.setFontSize(10);
            doc.setTextColor(200, 200, 200);
            doc.text("Conventional Frequencies", 14, yPos + 5);

            autoTable(doc, {
                startY: yPos + 8,
                head: [['Agency', 'Freq', 'Tone/CC', 'Mode', 'Alpha', 'Desc']],
                body: convRows,
                theme: 'grid',
                headStyles: { fillColor: [30, 41, 59], textColor: [34, 211, 238] },
                bodyStyles: { fillColor: [15, 23, 42], textColor: [200, 200, 200] },
                alternateRowStyles: { fillColor: [30, 41, 59] },
            });

            yPos = (doc as any).lastAutoTable.finalY + 10;
        }

        // Trunked Systems
        loc.data.trunkedSystems.forEach(sys => {
            if (yPos > 250) {
                doc.addPage();
                doc.setFillColor(15, 23, 42);
                doc.rect(0, 0, 210, 297, 'F');
                yPos = 20;
            }

            doc.setFontSize(10);
            doc.setTextColor(168, 85, 247); // Purple-400
            doc.text(`System: ${sys.name} (${sys.type})`, 14, yPos);
            yPos += 5;

            // Frequencies (New)
            if (sys.frequencies && sys.frequencies.length > 0) {
                doc.setFontSize(9);
                doc.setTextColor(150, 150, 150);
                const freqStr = sys.frequencies.map(f => `${f.freq}${f.use ? `(${f.use.substring(0, 1)})` : ''}`).join(', ');
                doc.text(`Control/Site Frequencies: ${freqStr}`, 14, yPos);
                yPos += 5;
            }

            const sysRows = sys.talkgroups.map(tg => [
                tg.dec,
                tg.mode,
                tg.alphaTag,
                tg.tag,
                tg.description
            ]);

            if (sysRows.length > 0) {
                autoTable(doc, {
                    startY: yPos + 3,
                    head: [['TGID', 'Mode', 'Alpha', 'Tag', 'Desc']],
                    body: sysRows,
                    theme: 'grid',
                    headStyles: { fillColor: [30, 41, 59], textColor: [168, 85, 247] },
                    bodyStyles: { fillColor: [15, 23, 42], textColor: [200, 200, 200] },
                    alternateRowStyles: { fillColor: [30, 41, 59] },
                });

                yPos = (doc as any).lastAutoTable.finalY + 10;
            }
        });

        yPos += 10;
    });

    doc.save(`Trip_Plan_${trip.startLocation}_to_${trip.endLocation}.pdf`);
};
