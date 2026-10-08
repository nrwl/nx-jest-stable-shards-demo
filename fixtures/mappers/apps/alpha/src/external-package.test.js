require('../../../expect-case')(
  'alpha/external-package',
  require.resolve('@acme/alias-to-external-package'),
);
require('@acme/alias-to-external-package');
