# ************************************************************
# Sequel Pro SQL dump
# Version 5446
#
# https://www.sequelpro.com/
# https://github.com/sequelpro/sequelpro
#
# Host: 127.0.0.1 (MySQL 5.7.21)
# Database: blocksig
# Generation Time: 2020-08-07 01:29:02 +0000
# ************************************************************


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
SET NAMES utf8mb4;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


# Dump of table docs
# ------------------------------------------------------------

DROP TABLE IF EXISTS `docs`;

CREATE TABLE `docs` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 DEFAULT NULL,
  `url` varchar(255) DEFAULT NULL,
  `orig_hash` varchar(64) DEFAULT NULL,
  `final_hash` varchar(64) DEFAULT NULL,
  `sender` text,
  `plan` enum('free','monthly','paygo') DEFAULT 'free',
  `stripeCustomer` varchar(100) DEFAULT NULL,
  `signatures` text,
  `signers` text,
  `token` varchar(64) DEFAULT NULL,
  `txHash` varchar(64) DEFAULT NULL,
  `prevHash` varchar(64) DEFAULT NULL,
  `status` enum('unconfirmed','confirmed','pending','signed','rejected','canceled','pendingnotary','notarized') DEFAULT 'unconfirmed',
  `notarize` tinyint(1) DEFAULT NULL,
  `ctime` int(14) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;



# Dump of table requests
# ------------------------------------------------------------

DROP TABLE IF EXISTS `requests`;

CREATE TABLE `requests` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `token` varchar(64) DEFAULT NULL,
  `doc_id` int(11) unsigned DEFAULT NULL,
  `signer_id` int(11) DEFAULT NULL,
  `address` varchar(40) DEFAULT NULL,
  `txHash` varchar(64) DEFAULT NULL,
  `prevHash` varchar(64) DEFAULT NULL,
  `status` enum('pending','signed','propagated','rejected') DEFAULT 'pending',
  `stime` int(14) unsigned DEFAULT NULL,
  `btime` int(14) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  UNIQUE KEY `doc_id` (`doc_id`,`signer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;



# Dump of table stripe_charges
# ------------------------------------------------------------

DROP TABLE IF EXISTS `stripe_charges`;

CREATE TABLE `stripe_charges` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `charge_id` varchar(100) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `doc_id` int(11) DEFAULT NULL,
  `ctime` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;



# Dump of table stripe_subscriptions
# ------------------------------------------------------------

DROP TABLE IF EXISTS `stripe_subscriptions`;

CREATE TABLE `stripe_subscriptions` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `subscription_id` varchar(100) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `doc_id` int(11) DEFAULT NULL,
  `ctime` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;




/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
