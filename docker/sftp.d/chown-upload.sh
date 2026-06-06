#!/bin/sh
# atmoz/sftp runs every executable in /etc/sftp.d/ at startup (as root) before
# sshd. Named-volume mountpoints come up owned by root, so the SFTP user can't
# write to them; chown the upload dir to the user (uid/gid 1001 from the
# `command:` in docker-compose.yaml).
chown -R 1001:1001 /home/marc/upload
