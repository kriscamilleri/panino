# Odoo Enterprise for developing the Odoo integration, built by
# `scripts/odoo-dev.sh enterprise <path to odoo enterprise .deb>`.
#
# The build context is the folder holding the .deb, never the repository: the
# Enterprise package is licensed to its subscriber and must not be committed.
# The official image provides the system dependencies; the Enterprise package
# replaces its Community `odoo` package (an older-sorting version string, hence
# --allow-downgrades).
ARG ODOO_SERIES=20.0
FROM odoo:${ODOO_SERIES}
ARG DEB_FILE=odoo-enterprise.deb

USER root
COPY ${DEB_FILE} /tmp/odoo-enterprise.deb
RUN apt-get update \
    && apt-get install -y --no-install-recommends --allow-downgrades /tmp/odoo-enterprise.deb \
    && rm -rf /var/lib/apt/lists/* /tmp/odoo-enterprise.deb
USER odoo
