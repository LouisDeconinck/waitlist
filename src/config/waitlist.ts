export interface WaitlistOptionalFieldOption {
  label: string;
  value: string;
}

export interface WaitlistOptionalField {
  key: string;
  label: string;
  placeholder?: string;
  helperText?: string;
  maxLength?: number;
  type: 'text' | 'textarea' | 'select';
  options?: WaitlistOptionalFieldOption[];
}

export interface WaitlistHowItWorksStep {
  title: string;
  description: string;
  mockupLabel: string;
}

export interface WaitlistTemplateConfig {
  productName: string;
  audience: string;
  headline: string;
  subheadline: string;
  proofPoint: string;
  whyNow: string[];
  ctaPrimary: string;
  ctaSecondary: string;
  ctaTertiary: string;
  qualifierLabel: string;
  qualifierOptions: WaitlistOptionalFieldOption[];
  legalBlurb: string;
  howItWorks: WaitlistHowItWorksStep[];
  optionalFields: WaitlistOptionalField[];
}

export const waitlistConfig: WaitlistTemplateConfig = {
  productName: 'WaitlistTemplate',
  audience: 'Early Adopters',
  headline: 'Be the first to experience the future.',
  subheadline:
    'Sign up for early access to our platform. Join an exclusive group of early adopters and help shape our product roadmap.',
  proofPoint: 'Join hundreds of forward-thinking teams. Early access rolling out soon.',
  whyNow: [
    'Get early access with priority onboarding in the first pilot wave.',
    'Lock in founding pricing for the first 30 shops that join.',
    'Join a founding customer Slack channel with a monthly product feedback call.',
  ],
  ctaPrimary: 'Get early access',
  ctaSecondary: 'Join the pilot',
  ctaTertiary: 'Reserve your spot',
  qualifierLabel: 'I am joining as',
  qualifierOptions: [
    { label: 'Founder or Executive', value: 'founder_exec' },
    { label: 'Product Manager', value: 'product_manager' },
    { label: 'Software Engineer', value: 'software_engineer' },
    { label: 'Other', value: 'other' },
  ],
  legalBlurb: 'No spam. We will only send pilot and launch updates.',
  howItWorks: [
    {
      title: 'Join the pilot waitlist',
      description: 'Submit your email to reserve a place in the next onboarding wave.',
      mockupLabel: 'Step 1 - join',
    },
    {
      title: 'Share your use case',
      description: 'Tell us a bit about your goals so we can tailor the onboarding experience to your needs.',
      mockupLabel: 'Step 2 - customize',
    },
    {
      title: 'Go live with priority setup',
      description: 'Get guided onboarding and start exploring the platform right away.',
      mockupLabel: 'Step 3 - launch',
    },
  ],
  optionalFields: [
    {
      key: 'useCase',
      type: 'textarea',
      label: 'What would you use this for?',
      placeholder: 'Optional: share the main workflow or bottleneck you want to improve.',
      helperText: 'This helps us prioritize your onboarding.',
      maxLength: 1200,
    },
  ],
};
