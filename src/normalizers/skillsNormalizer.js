'use strict';

/**
 * Canonical skill alias map.
 * Keys: lowercase variants. Values: canonical display name.
 */
const SKILL_ALIASES = {
  // JavaScript ecosystem
  'js': 'JavaScript', 'javascript': 'JavaScript',
  'ts': 'TypeScript', 'typescript': 'TypeScript',
  'node': 'Node.js', 'nodejs': 'Node.js', 'node.js': 'Node.js', 'node js': 'Node.js',
  'react': 'React', 'reactjs': 'React', 'react.js': 'React', 'react js': 'React',
  'vue': 'Vue.js', 'vuejs': 'Vue.js', 'vue.js': 'Vue.js',
  'angular': 'Angular', 'angularjs': 'Angular',
  'next': 'Next.js', 'nextjs': 'Next.js', 'next.js': 'Next.js',
  'express': 'Express.js', 'expressjs': 'Express.js', 'express.js': 'Express.js',
  'svelte': 'Svelte', 'webpack': 'Webpack', 'vite': 'Vite',
  'jquery': 'jQuery', 'deno': 'Deno', 'bun': 'Bun',
  'jest': 'Jest', 'mocha': 'Mocha', 'cypress': 'Cypress',

  // Python ecosystem
  'py': 'Python', 'python': 'Python', 'python3': 'Python',
  'django': 'Django', 'flask': 'Flask', 'fastapi': 'FastAPI',
  'pandas': 'Pandas', 'numpy': 'NumPy', 'scipy': 'SciPy',
  'matplotlib': 'Matplotlib', 'scikit-learn': 'Scikit-learn', 'sklearn': 'Scikit-learn',
  'tensorflow': 'TensorFlow', 'tf': 'TensorFlow',
  'pytorch': 'PyTorch', 'torch': 'PyTorch',
  'keras': 'Keras', 'hugging face': 'Hugging Face', 'huggingface': 'Hugging Face',

  // Data / ML
  'ml': 'Machine Learning', 'machine learning': 'Machine Learning',
  'ai': 'Artificial Intelligence', 'artificial intelligence': 'Artificial Intelligence',
  'dl': 'Deep Learning', 'deep learning': 'Deep Learning',
  'nlp': 'Natural Language Processing', 'natural language processing': 'Natural Language Processing',
  'cv': 'Computer Vision', 'computer vision': 'Computer Vision',
  'data science': 'Data Science', 'data engineering': 'Data Engineering',
  'etl': 'ETL', 'spark': 'Apache Spark', 'apache spark': 'Apache Spark',
  'hadoop': 'Hadoop', 'kafka': 'Apache Kafka', 'apache kafka': 'Apache Kafka',
  'airflow': 'Apache Airflow',

  // Databases
  'sql': 'SQL', 'mysql': 'MySQL',
  'postgresql': 'PostgreSQL', 'postgres': 'PostgreSQL',
  'mongodb': 'MongoDB', 'mongo': 'MongoDB',
  'redis': 'Redis', 'elasticsearch': 'Elasticsearch',
  'cassandra': 'Apache Cassandra', 'dynamodb': 'DynamoDB',
  'sqlite': 'SQLite', 'oracle': 'Oracle DB',
  'mssql': 'Microsoft SQL Server', 'sql server': 'Microsoft SQL Server',
  'neo4j': 'Neo4j', 'snowflake': 'Snowflake',
  'bigquery': 'BigQuery', 'redshift': 'Amazon Redshift',

  // Cloud / DevOps
  'aws': 'AWS', 'amazon web services': 'AWS',
  'gcp': 'Google Cloud Platform', 'google cloud': 'Google Cloud Platform',
  'google cloud platform': 'Google Cloud Platform',
  'azure': 'Microsoft Azure', 'microsoft azure': 'Microsoft Azure',
  'docker': 'Docker', 'kubernetes': 'Kubernetes', 'k8s': 'Kubernetes',
  'terraform': 'Terraform', 'ansible': 'Ansible', 'jenkins': 'Jenkins',
  'github actions': 'GitHub Actions',
  'ci/cd': 'CI/CD', 'cicd': 'CI/CD', 'devops': 'DevOps',
  'sre': 'Site Reliability Engineering',
  'microservices': 'Microservices',
  'nginx': 'Nginx', 'linux': 'Linux', 'unix': 'Unix',
  'bash': 'Bash', 'shell': 'Shell Scripting', 'shell scripting': 'Shell Scripting',

  // Languages
  'java': 'Java',
  'c++': 'C++', 'cpp': 'C++',
  'c#': 'C#', 'csharp': 'C#',
  'golang': 'Go', 'go': 'Go',
  'rust': 'Rust', 'ruby': 'Ruby',
  'rails': 'Ruby on Rails', 'ruby on rails': 'Ruby on Rails', 'ror': 'Ruby on Rails',
  'php': 'PHP', 'swift': 'Swift', 'kotlin': 'Kotlin',
  'scala': 'Scala', 'r': 'R', 'matlab': 'MATLAB',
  'perl': 'Perl', 'lua': 'Lua', 'dart': 'Dart', 'flutter': 'Flutter',

  // Web / APIs
  'html': 'HTML', 'html5': 'HTML',
  'css': 'CSS', 'css3': 'CSS',
  'scss': 'SCSS/Sass', 'sass': 'SCSS/Sass',
  'rest': 'REST API', 'rest api': 'REST API', 'restful': 'REST API',
  'graphql': 'GraphQL', 'grpc': 'gRPC',
  'websocket': 'WebSockets', 'websockets': 'WebSockets',

  // Version control / Collaboration
  'git': 'Git', 'github': 'GitHub', 'gitlab': 'GitLab', 'bitbucket': 'Bitbucket',
  'jira': 'Jira', 'confluence': 'Confluence',
  'agile': 'Agile', 'scrum': 'Scrum', 'kanban': 'Kanban',

  // Design
  'figma': 'Figma', 'sketch': 'Sketch',
  'photoshop': 'Adobe Photoshop', 'illustrator': 'Adobe Illustrator',
  'ui/ux': 'UI/UX Design', 'ui ux': 'UI/UX Design',

  // Analytics / BI
  'tableau': 'Tableau', 'power bi': 'Power BI', 'powerbi': 'Power BI',
  'excel': 'Microsoft Excel', 'looker': 'Looker',

  // Security
  'cybersecurity': 'Cybersecurity',
  'penetration testing': 'Penetration Testing', 'pentest': 'Penetration Testing',
  'owasp': 'OWASP',
};

/**
 * Canonicalize a single skill name.
 * Returns null for empty/null input. Never invents a value.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function canonicalizeSkill(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const key = trimmed.toLowerCase();
  if (SKILL_ALIASES[key]) return SKILL_ALIASES[key];

  // Title-case fallback — preserves unknown but valid skills
  return trimmed
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Canonicalize an array of skill strings, deduplicating by canonical name.
 *
 * @param {string[]} raws
 * @returns {string[]}
 */
function canonicalizeSkills(raws) {
  const seen   = new Set();
  const result = [];
  for (const raw of (raws || [])) {
    const canonical = canonicalizeSkill(raw);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      result.push(canonical);
    }
  }
  return result;
}

module.exports = { canonicalizeSkill, canonicalizeSkills, SKILL_ALIASES };
