
import { ScanResult, GeneratedManual, ManualSection, ManualStep, TrunkedSystem, Agency } from '../types';

/**
 * Maps RadioReference System Types to Uniden SDS Menu Names
 */
const mapSystemType = (rrType: string): string => {
  const t = rrType.toLowerCase();
  if (t.includes('p25') || t.includes('project 25')) {
    if (t.includes('one') || t.includes('single')) return 'P25 One Frequency';
    return 'P25 Trunk';
  }
  if (t.includes('dmr') || t.includes('mototrbo') || t.includes('capacity') || t.includes('connect')) {
    if (t.includes('one') || t.includes('single')) return 'DMR One Frequency';
    return 'MotoTRBO Trunk';
  }
  if (t.includes('nxdn') || t.includes('nexedge') || t.includes('idas')) {
    if (t.includes('one') || t.includes('single')) return 'NXDN One Frequency';
    return 'NXDN Trunk';
  }
  if (t.includes('edacs')) return 'EDACS';
  if (t.includes('ltr')) return 'LTR';
  if (t.includes('motorola')) return 'Motorola';
  
  return 'Conventional'; // Fallback
};

/**
 * Generates the "One-Time Setup" section
 */
const generateSetupSection = (locationName: string): ManualSection => {
  return {
    title: "1. Global Setup: Create Favorites List",
    description: "Perform this step once to create a container for this location.",
    steps: [
      { text: "Press [Menu] key." },
      { text: "Scroll to 'Manage Favorites Lists' and press [E/yes]." },
      { text: "Scroll to 'New Favorites List' and press [E/yes]." },
      { 
        text: "Enter a name for this list using the keypad/knob. We recommend:", 
        value: locationName.substring(0, 10) 
      },
      { text: "Press [E/yes] when finished naming." },
      { text: "Press [E/yes] again to accept default Quick Key settings if prompted." }
    ]
  };
};

/**
 * Generates Conventional Programming instructions
 */
const generateConventionalSection = (agencies: Agency[]): ManualSection | null => {
  if (agencies.length === 0) return null;

  const steps: ManualStep[] = [];

  // 1. Enter System
  steps.push(
    { text: "Press [Menu] -> 'Manage Favorites Lists'." },
    { text: "Select your Favorites List and press [E/yes]." },
    { text: "Select 'Review/Edit System' -> 'New System'." },
    { text: "Scroll to 'Conventional' and press [E/yes]." },
    { text: "At 'Confirm?', press [E/yes]." },
    { text: "Select 'Edit Name', enter 'Local Analog', press [E/yes]." }
  );

  // 2. Loop Agencies
  agencies.forEach(agency => {
    if (!agency.frequencies || agency.frequencies.length === 0) return;

    // Create Department
    const deptSteps: ManualStep[] = [
      { text: "Select 'Edit Department' -> 'New Department'." },
      { text: "Enter Name:", value: agency.name },
      { text: "Press [E/yes]." }
    ];

    // Create Channels
    agency.frequencies.forEach(freq => {
      const channelSteps: ManualStep[] = [
        { text: "Scroll to 'New Channel' and press [E/yes]." },
        { text: "Enter Frequency (Use [.no] for decimal):", value: freq.freq },
        { text: "Press [E/yes]. Scanner opens Channel Options." },
        { 
          text: "Select 'Edit Name'. Enter:", 
          value: (freq.alphaTag || freq.description).substring(0, 16) 
        },
        { text: "Press [E/yes]." }
      ];

      // Audio Type
      if (freq.mode) {
        let audioType = 'All';
        if (freq.mode.includes('P25') || freq.mode.includes('DMR') || freq.mode.includes('NXDN')) audioType = 'Digital Only';
        else if (freq.mode.includes('FM') || freq.mode.includes('NFM')) audioType = 'Analog Only';
        
        channelSteps.push({ text: "Select 'Set Audio Type'. Choose:", value: audioType });
      }

      // Tones/NAC
      if (freq.tone || freq.nac || freq.colorCode) {
         let type = "Set CTCSS/DCS";
         let val = freq.tone;
         
         if (freq.nac) { type = "Set P25 NAC"; val = freq.nac; }
         if (freq.colorCode) { type = "Set Color Code"; val = freq.colorCode; }

         if (val) {
             channelSteps.push({ text: `Select '${type}'. Set to:`, value: val });
         }
      }

      // Exit Channel
      channelSteps.push({ text: "Press [Menu] once to go back to Department." });

      deptSteps.push({
        text: `Add Channel: ${freq.freq}`,
        subSteps: channelSteps
      });
    });

    // Exit Department
    deptSteps.push({ text: "Press [Menu] once to go back to System." });

    steps.push({
      text: `Create Department: ${agency.name}`,
      subSteps: deptSteps
    });
  });

  return {
    title: "2. Conventional Frequencies",
    description: "Follow these steps to program analog agencies (Police, Fire, EMS).",
    steps
  };
};

/**
 * Generates Trunked Programming instructions
 */
const generateTrunkedSection = (systems: TrunkedSystem[], startingIndex: number): ManualSection[] => {
  const sections: ManualSection[] = [];

  systems.forEach((sys, idx) => {
    const unidenType = mapSystemType(sys.type);
    const steps: ManualStep[] = [];

    // 1. Create System
    steps.push(
      { text: "Press [Menu] -> 'Manage Favorites Lists'." },
      { text: "Select your Favorites List -> 'Review/Edit System' -> 'New System'." },
      { text: "Scroll to and select:", value: unidenType },
      { text: "At 'Confirm?', press [E/yes]." },
      { text: "Select 'Edit Name', enter:", value: sys.name.substring(0, 20) }
    );

    // 2. Create Site
    steps.push(
      { text: "Select 'Edit Site' -> 'New Site'." },
      { text: "Enter Site Name (e.g. 'Simulcast') -> [E/yes]." },
      { text: "Select 'Set Frequencies' -> 'New Frequency'." }
    );
    
    // Add Frequency Entries
    if (sys.frequencies && sys.frequencies.length > 0) {
        sys.frequencies.forEach((f, i) => {
            steps.push(
                { text: `Enter Frequency ${i + 1}:`, value: f.freq },
                { text: "Press [E/yes]." },
                { text: "Select 'New Frequency' if more exist, or press [Menu] to go back." }
            );
        });
    } else {
        // Fallback if AI didn't return freqs
        steps.push(
            { text: "** CRITICAL **: Enter the Control Channel frequencies found in the scan results." }
        );
    }

    steps.push({ text: "Press [Menu] repeatedly to back out to System Menu." });

    // 3. Departments & Talkgroups
    const deptSteps: ManualStep[] = [];
    
    // Group TGs by 'tag' (Service Type) roughly to create departments
    const groups: Record<string, typeof sys.talkgroups> = {};
    sys.talkgroups.forEach(tg => {
        const key = tg.tag || "Misc";
        if (!groups[key]) groups[key] = [];
        groups[key].push(tg);
    });

    Object.entries(groups).forEach(([deptName, tgs]) => {
        const groupSteps: ManualStep[] = [
            { text: "Select 'Edit Department' -> 'New Department'." },
            { text: "Enter Name:", value: deptName },
            { text: "Press [E/yes]." }
        ];

        tgs.forEach(tg => {
            groupSteps.push({
                text: `Add TGID ${tg.dec}`,
                subSteps: [
                    { text: "Select 'New Channel'." },
                    { text: "Enter TGID:", value: tg.dec },
                    { text: "Select 'Edit Name'. Enter:", value: tg.alphaTag },
                    { text: "Select 'Set Service Type'. Choose:", value: tg.tag },
                    { text: "Press [Menu] to return to Department." }
                ]
            });
        });
        
        groupSteps.push({ text: "Press [Menu] to return to System." });

        deptSteps.push({
            text: `Department: ${deptName}`,
            subSteps: groupSteps
        });
    });

    steps.push(...deptSteps);

    sections.push({
        title: `${startingIndex + idx}. Trunked System: ${sys.name}`,
        description: `Programming for ${sys.type} system.`,
        steps
    });
  });

  return sections;
};

/**
 * Main Generator Function
 */
export const generateScannerManual = (data: ScanResult): GeneratedManual => {
  const sections: ManualSection[] = [];

  // 1. Global Setup
  sections.push(generateSetupSection(data.locationName));

  // 2. Conventional
  const convSection = generateConventionalSection(data.agencies);
  if (convSection) sections.push(convSection);

  // 3. Trunked
  const trunkSections = generateTrunkedSection(data.trunkedSystems, sections.length + 1);
  sections.push(...trunkSections);

  // 4. Finalizing
  sections.push({
    title: "Final Steps: Activate Scanning",
    steps: [
      { text: "Press [Menu] to exit all menus." },
      { text: "Press [Menu] -> 'Set Scan Selection' -> 'Select Lists to Monitor'." },
      { text: "Ensure your new Favorites List is set to [On]." },
      { text: "Press [Menu] -> 'Select Service Types'." },
      { text: "Ensure types like 'Law Dispatch', 'Fire Dispatch', etc. are checked." },
      { text: "Press [System] (left side key) to resume scanning." }
    ]
  });

  return {
    title: `SDS Programming Manual: ${data.locationName}`,
    sections
  };
};
